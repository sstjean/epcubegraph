#!/bin/bash
# mirror-db.sh — Mirror a source environment's PostgreSQL data into a target
# environment, using ephemeral VNet peerings managed by infra/runner-pg-access.
#
# Usage:
#   scripts/mirror-db.sh <source_env> <target_env>
#
# Example (mirror prod → staging):
#   scripts/mirror-db.sh epcubegraph epcubegraph-b124-dev
#
# What it does (all reversible, all cleaned up by trap EXIT):
#   1. terraform apply infra/runner-pg-access for SOURCE  → peers runner VNet
#      into source-env VNet, links source's Postgres private DNS zone.
#   2. terraform apply infra/runner-pg-access for TARGET  → same for target.
#   3. Grants the runner's system-assigned managed identity 'get' on both
#      Key Vaults (access-policy mode) so it can fetch DSNs.
#   4. Invokes the runner VM via 'az vm run-command' to run
#      `pg_dump <source> | psql <target>` and prints a verification summary.
#   5. trap EXIT — ALWAYS — revokes the KV policies and `terraform destroy`s
#      both per-env stacks, removing all peerings and DNS links.
#
# Safety:
#   - When NOT running, the runner has zero network path to either Postgres.
#   - Destroys data in the TARGET environment. Refuses to run if target == prod.
#   - On crash (SIGKILL etc.) trap won't fire; recover manually with
#       az network vnet peering delete --name runner-to-<env> --vnet-name github-runner-vnet --resource-group tfstate-rg
#       az network vnet peering delete --name <env>-to-runner --vnet-name <env>-vnet --resource-group <env>-rg
#       az network private-dns link vnet delete --zone-name <env>.postgres.database.azure.com --name runner-mirror-<env> --resource-group <env>-rg
#       az keyvault delete-policy --name <env>-kv --object-id <runner-mi-object-id>

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

RUNNER_MI_OBJECT_ID="eca6ef16-443a-44c8-a74d-e381e0e5e87f"
RUNNER_RG="tfstate-rg"
RUNNER_VM="github-runner-01"
PROD_ENV_NAME="epcubegraph"

# ── Input validation ─────────────────────────────────────────────────────────

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <source_env> <target_env>"
    echo "Example: $0 epcubegraph epcubegraph-b124-dev"
    exit 64
fi

SOURCE_ENV="$1"
TARGET_ENV="$2"

if [[ "$TARGET_ENV" == "$PROD_ENV_NAME" ]]; then
    echo "ERROR: refusing to mirror INTO production ($PROD_ENV_NAME)." >&2
    echo "       This script wipes the target DB. Production must never be a target." >&2
    exit 65
fi

if [[ "$SOURCE_ENV" == "$TARGET_ENV" ]]; then
    echo "ERROR: source and target must differ." >&2
    exit 66
fi

# ── Confirmation ─────────────────────────────────────────────────────────────

cat <<EOF

About to mirror PostgreSQL data:
  SOURCE: $SOURCE_ENV   (READ-ONLY)
  TARGET: $TARGET_ENV   (will be WIPED and REPLACED)

This will:
  • Temporarily peer the runner VNet with both environments
  • Grant the runner MI 'get' on both Key Vaults
  • Run pg_dump | psql to copy ALL DB content from source to target
  • Revoke KV access and unpeer when done (or if interrupted)

EOF

read -r -p "Type the target env name to confirm: " CONFIRM
if [[ "$CONFIRM" != "$TARGET_ENV" ]]; then
    echo "Aborted (confirmation did not match)."
    exit 1
fi

# ── Setup working dirs ───────────────────────────────────────────────────────

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TF_MODULE="$REPO_ROOT/infra/runner-pg-access"

if [[ ! -d "$TF_MODULE" ]]; then
    echo "ERROR: $TF_MODULE not found." >&2
    exit 2
fi

WORK_ROOT=$(mktemp -d -t epcubegraph-mirror-XXXXXX)
SRC_WORK="$WORK_ROOT/source-$SOURCE_ENV"
TGT_WORK="$WORK_ROOT/target-$TARGET_ENV"
mkdir -p "$SRC_WORK" "$TGT_WORK"
cp "$TF_MODULE"/*.tf "$SRC_WORK/"
cp "$TF_MODULE"/*.tf "$TGT_WORK/"

echo "Working state directory: $WORK_ROOT"

# ── Cleanup (always runs) ────────────────────────────────────────────────────

cleanup() {
    local rc=$?
    set +e
    echo
    echo "=== CLEANUP (script exit code=$rc) ==="

    if az keyvault show --name "${SOURCE_ENV}-kv" -o none 2>/dev/null; then
        echo "→ Revoking KV policy on ${SOURCE_ENV}-kv..."
        az keyvault delete-policy --name "${SOURCE_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" -o none 2>/dev/null || true
    fi
    if az keyvault show --name "${TARGET_ENV}-kv" -o none 2>/dev/null; then
        echo "→ Revoking KV policy on ${TARGET_ENV}-kv..."
        az keyvault delete-policy --name "${TARGET_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" -o none 2>/dev/null || true
    fi

    if [[ -f "$SRC_WORK/terraform.tfstate" ]]; then
        echo "→ Destroying source network access ($SOURCE_ENV)..."
        (cd "$SRC_WORK" && terraform destroy -auto-approve -var "environment_name=$SOURCE_ENV") || \
            echo "WARN: terraform destroy for source returned non-zero — inspect $SRC_WORK"
    fi
    if [[ -f "$TGT_WORK/terraform.tfstate" ]]; then
        echo "→ Destroying target network access ($TARGET_ENV)..."
        (cd "$TGT_WORK" && terraform destroy -auto-approve -var "environment_name=$TARGET_ENV") || \
            echo "WARN: terraform destroy for target returned non-zero — inspect $TGT_WORK"
    fi

    # Only remove WORK_ROOT if both destroys succeeded (no leftover state to recover)
    if [[ ! -f "$SRC_WORK/terraform.tfstate" || ! -s "$SRC_WORK/terraform.tfstate" ]] && \
       [[ ! -f "$TGT_WORK/terraform.tfstate" || ! -s "$TGT_WORK/terraform.tfstate" ]]; then
        rm -rf "$WORK_ROOT"
        echo "→ Removed $WORK_ROOT"
    else
        echo "→ State preserved at $WORK_ROOT for manual recovery"
    fi

    echo "Cleanup complete (exit $rc)."
    exit $rc
}
trap cleanup EXIT INT TERM

# ── Apply ephemeral network access ───────────────────────────────────────────

echo
echo "=== APPLY: SOURCE network access ($SOURCE_ENV) ==="
(cd "$SRC_WORK" && terraform init -input=false && terraform apply -auto-approve -var "environment_name=$SOURCE_ENV")

echo
echo "=== APPLY: TARGET network access ($TARGET_ENV) ==="
(cd "$TGT_WORK" && terraform init -input=false && terraform apply -auto-approve -var "environment_name=$TARGET_ENV")

# ── Grant runner MI access to both KVs ───────────────────────────────────────

echo
echo "=== GRANT: KV secret 'get' for runner MI ==="
az keyvault set-policy --name "${SOURCE_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" --secret-permissions get -o none
az keyvault set-policy --name "${TARGET_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" --secret-permissions get -o none

# ── Build the runner-side script ─────────────────────────────────────────────

RUNNER_SCRIPT=$(mktemp -t mirror-runner-XXXXXX.sh)
cat > "$RUNNER_SCRIPT" <<EOF
#!/bin/bash
set -euo pipefail

az login --identity --output none

# Install pg client 17 (idempotent)
if ! command -v /usr/lib/postgresql/17/bin/pg_dump >/dev/null 2>&1; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \\
        | sudo gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main" \\
        | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client-17 >/dev/null
fi

PG=/usr/lib/postgresql/17/bin
echo "Using \$("\$PG/pg_dump" --version)"

# Fetch DSNs (never echoed)
SRC_DSN=\$(az keyvault secret show --vault-name "${SOURCE_ENV}-kv" --name exporter-postgres-dsn --query value -o tsv)
TGT_DSN=\$(az keyvault secret show --vault-name "${TARGET_ENV}-kv" --name exporter-postgres-dsn --query value -o tsv)

echo "Mirror: $SOURCE_ENV → $TARGET_ENV"
"\$PG/pg_dump" --no-owner --no-acl --clean --if-exists --format=plain -d "\$SRC_DSN" \\
    | "\$PG/psql" --quiet --set ON_ERROR_STOP=on --dbname="\$TGT_DSN" 2>&1 \\
    | tail -20

echo
echo "=== TARGET devices ==="
"\$PG/psql" -d "\$TGT_DSN" -c "SELECT device_id, device_class, status, updated_at FROM devices ORDER BY device_id;"
echo
echo "=== TARGET pending_replacements ==="
"\$PG/psql" -d "\$TGT_DSN" -c "SELECT * FROM pending_replacements;"
EOF

# ── Invoke on the runner ─────────────────────────────────────────────────────

echo
echo "=== MIRROR: running pg_dump | psql on $RUNNER_VM ==="
az vm run-command invoke \
    -g "$RUNNER_RG" -n "$RUNNER_VM" \
    --command-id RunShellScript \
    --scripts "@$RUNNER_SCRIPT" \
    --query "value[0].message" -o tsv

rm -f "$RUNNER_SCRIPT"

echo
echo "=== MIRROR COMPLETE ==="
echo "Trap will now revoke KV access and tear down VNet peerings."
