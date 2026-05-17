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
# Design (sequential — only one env peered at a time):
#   Source and target env VNets share the same CIDR (10.0.0.0/16) by branch
#   pattern, so they cannot both be peered to the runner VNet simultaneously
#   (Azure: VnetAddressSpaceOverlapsWithAlreadyPeeredVnet).
#
#     Phase A — SOURCE:
#       apply TF (peer + DNS) → grant KV → pg_dump to /tmp/<dump> on runner
#                              → revoke KV → destroy TF
#     Phase B — TARGET:
#       apply TF (peer + DNS) → grant KV → psql restore from /tmp/<dump>
#                              → remove /tmp/<dump> → revoke KV → destroy TF
#
# Safety:
#   - When NOT running, the runner has zero network path to either Postgres.
#   - Refuses to target production.
#   - Confirmation prompt requires typing the target env name.
#   - trap EXIT/INT/TERM revokes any KV policies, removes the runner dump,
#     destroys any TF state that exists; preserves state under /tmp on
#     failure for manual recovery.
#   - On SIGKILL (no trap), recover with:
#       az network vnet peering delete --name runner-to-<env> --vnet-name github-runner-vnet --resource-group tfstate-rg
#       az network vnet peering delete --name <env>-to-runner --vnet-name <env>-vnet --resource-group <env>-rg
#       az network private-dns link vnet delete --zone-name <env>.postgres.database.azure.com --name runner-mirror-<env> --resource-group <env>-rg
#       az keyvault delete-policy --name <env>-kv --object-id <runner-mi-object-id>
#       az vm run-command invoke -g tfstate-rg -n github-runner-01 --command-id RunShellScript --scripts "rm -f /tmp/epcubegraph-mirror-*.sql.gz"

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

RUNNER_MI_OBJECT_ID="eca6ef16-443a-44c8-a74d-e381e0e5e87f"
RUNNER_RG="tfstate-rg"
RUNNER_VM="github-runner-01"
PROD_ENV_NAME="epcubegraph"

# Unique dump file path on the runner, scoped to this script invocation
RUN_ID="$$-$(date +%s)"
RUNNER_DUMP_PATH="/tmp/epcubegraph-mirror-${RUN_ID}.sql.gz"

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

This runs in two phases (env VNets share CIDRs, only one can be peered
to the runner at a time):

  Phase A: peer runner→source, pg_dump to /tmp on runner, unpeer source.
  Phase B: peer runner→target, psql restore from /tmp on runner, unpeer.

The dump file lives only on the runner's local /tmp and is removed at the
end of phase B (or by trap cleanup on failure).

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
echo "Dump file on runner: $RUNNER_DUMP_PATH"

# ── Helper: returns 0 if the tfstate has at least one resource ───────────────

state_has_resources() {
    local state="$1"
    [[ -s "$state" ]] || return 1
    # tf state has "resources": [] (empty) when destroyed; non-empty list means leftover
    python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get('resources') else 1)" "$state" 2>/dev/null
}

# ── Cleanup (always runs) ────────────────────────────────────────────────────

cleanup() {
    local rc=$?
    set +e
    echo
    echo "=== CLEANUP (script exit code=$rc) ==="

    # Revoke KV policies (idempotent — delete-policy is harmless if not present)
    for kv_env in "$SOURCE_ENV" "$TARGET_ENV"; do
        if az keyvault show --name "${kv_env}-kv" -o none 2>/dev/null; then
            echo "→ Revoking KV policy on ${kv_env}-kv..."
            az keyvault delete-policy --name "${kv_env}-kv" --object-id "$RUNNER_MI_OBJECT_ID" -o none 2>/dev/null || true
        fi
    done

    # Best-effort removal of any leftover dump file on the runner
    echo "→ Removing leftover dump on runner..."
    az vm run-command invoke \
        -g "$RUNNER_RG" -n "$RUNNER_VM" \
        --command-id RunShellScript \
        --scripts "rm -f '$RUNNER_DUMP_PATH'" \
        --query "value[0].message" -o tsv >/dev/null 2>&1 || true

    # Destroy any leftover TF state
    if state_has_resources "$SRC_WORK/terraform.tfstate"; then
        echo "→ Destroying source network access ($SOURCE_ENV)..."
        (cd "$SRC_WORK" && terraform destroy -auto-approve -var "environment_name=$SOURCE_ENV") || \
            echo "WARN: terraform destroy for source returned non-zero — inspect $SRC_WORK"
    fi
    if state_has_resources "$TGT_WORK/terraform.tfstate"; then
        echo "→ Destroying target network access ($TARGET_ENV)..."
        (cd "$TGT_WORK" && terraform destroy -auto-approve -var "environment_name=$TARGET_ENV") || \
            echo "WARN: terraform destroy for target returned non-zero — inspect $TGT_WORK"
    fi

    # Remove WORK_ROOT only if no destroy left resources behind
    if ! state_has_resources "$SRC_WORK/terraform.tfstate" && ! state_has_resources "$TGT_WORK/terraform.tfstate"; then
        rm -rf "$WORK_ROOT"
        echo "→ Removed $WORK_ROOT"
    else
        echo "→ State preserved at $WORK_ROOT for manual recovery"
    fi

    echo "Cleanup complete (exit $rc)."
    exit $rc
}
trap cleanup EXIT INT TERM

# ── Helper: install pg client 17 on runner (idempotent) ──────────────────────

ensure_runner_pg_client() {
    local tmp; tmp=$(mktemp -t mirror-install-XXXXXX.sh)
    cat > "$tmp" <<'EOF'
#!/bin/bash
set -euo pipefail
if ! command -v /usr/lib/postgresql/17/bin/pg_dump >/dev/null 2>&1; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | sudo gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client-17 >/dev/null
fi
/usr/lib/postgresql/17/bin/pg_dump --version
EOF
    az vm run-command invoke \
        -g "$RUNNER_RG" -n "$RUNNER_VM" \
        --command-id RunShellScript --scripts "@$tmp" \
        --query "value[0].message" -o tsv
    rm -f "$tmp"
}

# ─── PHASE A: SOURCE ─────────────────────────────────────────────────────────

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  PHASE A: dump from SOURCE ($SOURCE_ENV)"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "→ Apply ephemeral peering to $SOURCE_ENV..."
(cd "$SRC_WORK" && terraform init -input=false && terraform apply -auto-approve -var "environment_name=$SOURCE_ENV")

echo
echo "→ Grant runner MI 'get' on ${SOURCE_ENV}-kv..."
az keyvault set-policy --name "${SOURCE_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" --secret-permissions get -o none

echo
echo "→ Ensure pg client 17 on runner..."
ensure_runner_pg_client

echo
echo "→ pg_dump $SOURCE_ENV → $RUNNER_DUMP_PATH (on runner)..."
DUMP_SCRIPT=$(mktemp -t mirror-dump-XXXXXX.sh)
cat > "$DUMP_SCRIPT" <<EOF
#!/bin/bash
set -euo pipefail
az login --identity --output none
PG=/usr/lib/postgresql/17/bin
DSN=\$(az keyvault secret show --vault-name "${SOURCE_ENV}-kv" --name exporter-postgres-dsn --query value -o tsv)
"\$PG/pg_dump" --no-owner --no-acl --clean --if-exists --format=plain -d "\$DSN" | gzip > "${RUNNER_DUMP_PATH}"
ls -lh "${RUNNER_DUMP_PATH}"
EOF
az vm run-command invoke \
    -g "$RUNNER_RG" -n "$RUNNER_VM" \
    --command-id RunShellScript --scripts "@$DUMP_SCRIPT" \
    --query "value[0].message" -o tsv
rm -f "$DUMP_SCRIPT"

echo
echo "→ Revoke runner KV policy on ${SOURCE_ENV}-kv..."
az keyvault delete-policy --name "${SOURCE_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" -o none

echo
echo "→ Destroy ephemeral peering to $SOURCE_ENV..."
(cd "$SRC_WORK" && terraform destroy -auto-approve -var "environment_name=$SOURCE_ENV")

# ─── PHASE B: TARGET ─────────────────────────────────────────────────────────

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  PHASE B: restore to TARGET ($TARGET_ENV)"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "→ Apply ephemeral peering to $TARGET_ENV..."
(cd "$TGT_WORK" && terraform init -input=false && terraform apply -auto-approve -var "environment_name=$TARGET_ENV")

echo
echo "→ Grant runner MI 'get' on ${TARGET_ENV}-kv..."
az keyvault set-policy --name "${TARGET_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" --secret-permissions get -o none

echo
echo "→ psql restore $RUNNER_DUMP_PATH → $TARGET_ENV (on runner)..."
RESTORE_SCRIPT=$(mktemp -t mirror-restore-XXXXXX.sh)
cat > "$RESTORE_SCRIPT" <<EOF
#!/bin/bash
set -euo pipefail
az login --identity --output none
PG=/usr/lib/postgresql/17/bin
DSN=\$(az keyvault secret show --vault-name "${TARGET_ENV}-kv" --name exporter-postgres-dsn --query value -o tsv)
gunzip -c "${RUNNER_DUMP_PATH}" | "\$PG/psql" --quiet --set ON_ERROR_STOP=on --dbname="\$DSN" 2>&1 | tail -20

echo
echo "=== TARGET devices ==="
"\$PG/psql" -d "\$DSN" -c "SELECT device_id, device_class, status, updated_at FROM devices ORDER BY device_id;"
echo
echo "=== TARGET pending_replacements ==="
"\$PG/psql" -d "\$DSN" -c "SELECT * FROM pending_replacements;"

rm -f "${RUNNER_DUMP_PATH}"
echo "Removed ${RUNNER_DUMP_PATH}"
EOF
az vm run-command invoke \
    -g "$RUNNER_RG" -n "$RUNNER_VM" \
    --command-id RunShellScript --scripts "@$RESTORE_SCRIPT" \
    --query "value[0].message" -o tsv
rm -f "$RESTORE_SCRIPT"

echo
echo "→ Revoke runner KV policy on ${TARGET_ENV}-kv..."
az keyvault delete-policy --name "${TARGET_ENV}-kv" --object-id "$RUNNER_MI_OBJECT_ID" -o none

echo
echo "→ Destroy ephemeral peering to $TARGET_ENV..."
(cd "$TGT_WORK" && terraform destroy -auto-approve -var "environment_name=$TARGET_ENV")

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  MIRROR COMPLETE: $SOURCE_ENV → $TARGET_ENV"
echo "════════════════════════════════════════════════════════════════════════"
