#!/usr/bin/env bash
# Unit test for infra/lib/az-json.sh (the az_json getter).
#
# Drives a stubbed `az` (infra/tests/stub-az) through the three outcomes the
# helper must distinguish — CLI success-with-output, CLI tool error, and
# CLI success-with-empty-output — and asserts that each maps to the correct
# AZ_JSON_RC / AZ_JSON_OUT / AZ_JSON_ERR globals and the correct call-site
# decision (pass / surface-real-error / report-absence).
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
decide_db() {
  if ! az_json resource show --ids "/fake/db/id" -o json; then
    echo "TOOL_ERROR: ${AZ_JSON_ERR}"
  elif [[ -z "$AZ_JSON_OUT" ]]; then
    echo "NOT_FOUND"
  else
    echo "PRESENT"
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
echo "Scenario 3: success-empty (CLI succeeds, empty output) — genuine absence"
# ---------------------------------------------------------------------------
STUB_AZ_MODE="success-empty"
export STUB_AZ_MODE
az_json resource show --ids x -o json
rc=$?
check "success-empty: AZ_JSON_RC is 0"                  "0"  "$rc"
check "success-empty: AZ_JSON_OUT is empty"             ""   "$AZ_JSON_OUT"
check "success-empty: AZ_JSON_ERR is empty"             ""   "$AZ_JSON_ERR"
check "success-empty: call-site decides NOT_FOUND"      "NOT_FOUND" "$(decide_db)"

# ---------------------------------------------------------------------------
echo ""
echo "Ran ${TESTS_RUN} assertions, ${TESTS_FAILED} failed."
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0
