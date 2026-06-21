#!/usr/bin/env bash
# Unit test for infra/lib/az-json.sh (the az_json getter).
#
# Drives a stubbed `az` (infra/tests/stub-az) through the three outcomes the
# helper must distinguish — CLI success-with-JSON-output, CLI tool error (e.g.
# unrecognized arguments), and resource-not-found (rc!=0, ResourceNotFound on
# stderr) — and asserts that each maps to the correct AZ_JSON_RC / AZ_JSON_OUT
# / AZ_JSON_ERR globals and the correct call-site decision.
#
# Run: bash infra/tests/test-az-json.sh   (exit 0 = all pass, 1 = any fail)

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${TEST_DIR}/../lib/az-json.sh"

# Shadow the real `az` with our stub: az_json invokes `az`, so we expose an
# `az` symlink (pointing at stub-az) on a temp bin dir placed first on PATH.
STUB_BIN="$(mktemp -d)"
ln -s "${TEST_DIR}/stub-az" "${STUB_BIN}/az"
trap 'rm -rf "$STUB_BIN"' EXIT
export PATH="${STUB_BIN}:${PATH}"

# shellcheck source=/dev/null
source "$LIB"

TESTS_RUN=0
TESTS_FAILED=0

check() {
  # check <description> <expected> <actual>
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  ok   - $desc"
  else
    echo "  FAIL - $desc"
    echo "         expected: [$expected]"
    echo "         actual:   [$actual]"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

check_contains() {
  # check_contains <description> <needle> <haystack>
  local desc="$1" needle="$2" haystack="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ok   - $desc"
  else
    echo "  FAIL - $desc"
    echo "         expected to contain: [$needle]"
    echo "         actual:              [$haystack]"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# A representative call-site block exercising the canonical fail-on-absence
# pattern from contracts/az-json.md. Returns the decision label on stdout so
# the test can assert which branch fired.
#
# Correct pattern (live-verified): missing resources exit non-zero with
# "ResourceNotFound" on stderr — they do NOT produce rc=0 with empty stdout.
decide_db() {
  if ! az_json resource show --ids "/fake/db/id" -o json; then
    if [[ "$AZ_JSON_ERR" == *"ResourceNotFound"* || "$AZ_JSON_ERR" == *"not found"* ]]; then
      echo "NOT_FOUND"
    else
      echo "TOOL_ERROR: ${AZ_JSON_ERR}"
    fi
  else
    echo "PRESENT"
  fi
}

# A representative call-site block for the Key Vault secret-list check, where a
# Forbidden/firewall error is an EXPECTED, recoverable condition that must route
# to the Container App fallback (DATAPLANE_BLOCKED) rather than fail. Any other
# non-zero exit is a genuine tool error. Mirrors the routing logic in
# infra/validate-deployment.sh section 6.
decide_kv() {
  if ! az_json keyvault secret list --vault-name "fake-kv" --query "[].name" -o tsv; then
    if [[ "$AZ_JSON_ERR" == *"Forbidden"* \
       || "$AZ_JSON_ERR" == *"Public network access is disabled"* \
       || "$AZ_JSON_ERR" == *"not from a trusted service"* ]]; then
      echo "DATAPLANE_BLOCKED"
    else
      echo "TOOL_ERROR: ${AZ_JSON_ERR}"
    fi
  else
    if [[ -z "$AZ_JSON_OUT" ]]; then
      echo "DATAPLANE_BLOCKED"
    else
      echo "PRESENT"
    fi
  fi
}

# ---------------------------------------------------------------------------
echo "Scenario 1: success-json (CLI succeeds, returns JSON)"
# ---------------------------------------------------------------------------
STUB_AZ_MODE="success-json"
export STUB_AZ_MODE
az_json resource show --ids x -o json
rc=$?
check        "success-json: AZ_JSON_RC is 0"            "0"  "$rc"
check        "success-json: AZ_JSON_RC global is 0"     "0"  "$AZ_JSON_RC"
check_contains "success-json: AZ_JSON_OUT has charset" '"charset":"UTF8"' "$AZ_JSON_OUT"
check        "success-json: AZ_JSON_ERR is empty"       ""   "$AZ_JSON_ERR"
check        "success-json: call-site decides PRESENT"  "PRESENT" "$(decide_db)"

# ---------------------------------------------------------------------------
echo "Scenario 2: error (CLI exits non-zero with stderr) — must NOT look like absence"
# ---------------------------------------------------------------------------
STUB_AZ_MODE="error"
export STUB_AZ_MODE
az_json resource show --ids x -o json
rc=$?
check          "error: AZ_JSON_RC is non-zero"          "2"  "$rc"
check          "error: AZ_JSON_OUT is empty"            ""   "$AZ_JSON_OUT"
check_contains "error: AZ_JSON_ERR has real message"    "unrecognized arguments" "$AZ_JSON_ERR"
db_decision="$(decide_db)"
check_contains "error: call-site surfaces TOOL_ERROR"   "TOOL_ERROR" "$db_decision"
check_contains "error: tool error carries real stderr"  "unrecognized arguments" "$db_decision"
# The whole point of #166: a tool error must NOT be reported as absence.
if [[ "$db_decision" == "NOT_FOUND" ]]; then
  echo "  FAIL - error: tool error was misreported as NOT_FOUND"
  TESTS_FAILED=$((TESTS_FAILED + 1))
else
  echo "  ok   - error: tool error is NOT misreported as NOT_FOUND"
fi
TESTS_RUN=$((TESTS_RUN + 1))

# ---------------------------------------------------------------------------
echo "Scenario 3: resource-not-found (rc!=0, ResourceNotFound on stderr) — genuine absence"
# ---------------------------------------------------------------------------
# Live-verified: az resource show/containerapp show for a missing resource
# exits non-zero (rc=3 or rc=1) with ResourceNotFound on stderr — NOT rc=0.
STUB_AZ_MODE="resource-not-found"
export STUB_AZ_MODE
az_json resource show --ids x -o json
rc=$?
check "resource-not-found: AZ_JSON_RC is non-zero"              "3"    "$rc"
check "resource-not-found: AZ_JSON_OUT is empty"                ""     "$AZ_JSON_OUT"
check_contains "resource-not-found: AZ_JSON_ERR has ResourceNotFound" "ResourceNotFound" "$AZ_JSON_ERR"
check "resource-not-found: call-site decides NOT_FOUND"         "NOT_FOUND" "$(decide_db)"
# Guard: resource-not-found must NOT be treated as TOOL_ERROR
db_decision_notfound="$(decide_db)"
if [[ "$db_decision_notfound" == TOOL_ERROR* ]]; then
  echo "  FAIL - resource-not-found: absence was misreported as TOOL_ERROR"
  TESTS_FAILED=$((TESTS_FAILED + 1))
else
  echo "  ok   - resource-not-found: absence is NOT misreported as TOOL_ERROR"
fi
TESTS_RUN=$((TESTS_RUN + 1))

# ---------------------------------------------------------------------------
echo "Scenario 4: forbidden (KV firewall blocks data-plane) — recoverable, NOT a tool error"
# ---------------------------------------------------------------------------
# Live-verified: az keyvault secret list with the KV firewall on (public network
# access disabled) exits non-zero with a Forbidden message on stderr. This is an
# expected, recoverable condition (issue #166 regression): it must route to the
# Container App fallback (DATAPLANE_BLOCKED), NOT be reported as a tool error.
STUB_AZ_MODE="forbidden"
export STUB_AZ_MODE
az_json keyvault secret list --vault-name fake-kv --query "[].name" -o tsv
rc=$?
check "forbidden: AZ_JSON_RC is non-zero"                  "1"  "$rc"
check "forbidden: AZ_JSON_OUT is empty"                    ""   "$AZ_JSON_OUT"
check_contains "forbidden: AZ_JSON_ERR has Forbidden"      "Forbidden" "$AZ_JSON_ERR"
kv_decision="$(decide_kv)"
check "forbidden: call-site decides DATAPLANE_BLOCKED"     "DATAPLANE_BLOCKED" "$kv_decision"
# Guard: a firewall block must NOT be misreported as a tool error (the bug).
if [[ "$kv_decision" == TOOL_ERROR* ]]; then
  echo "  FAIL - forbidden: firewall block was misreported as TOOL_ERROR"
  TESTS_FAILED=$((TESTS_FAILED + 1))
else
  echo "  ok   - forbidden: firewall block is NOT misreported as TOOL_ERROR"
fi
TESTS_RUN=$((TESTS_RUN + 1))

# ---------------------------------------------------------------------------
echo ""
echo "Ran ${TESTS_RUN} assertions, ${TESTS_FAILED} failed."
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0
