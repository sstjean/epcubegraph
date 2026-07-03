#!/usr/bin/env bash
# Unit test for infra/lib/telemetry.sh (telemetry_count parser).
#
# `telemetry_count` reads the JSON from `az monitor log-analytics query -o json`
# for a `... | summarize c=count()` query and echoes the integer count. It must
# treat empty / malformed / missing-column results as 0 so the caller can fail
# closed ("no telemetry" == "not flowing") — issue #164.
#
# Run: bash infra/tests/test-telemetry.sh   (exit 0 = all pass, 1 = any fail)

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${TEST_DIR}/../lib/telemetry.sh"

# shellcheck source=/dev/null
source "$LIB"

TESTS_RUN=0
TESTS_FAILED=0

check() {
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

check "flowing: c=\"5\" -> 5" "5" \
  "$(printf '%s' '[{"TableName":"PrimaryResult","c":"5"}]' | telemetry_count)"

check "zero: c=\"0\" -> 0" "0" \
  "$(printf '%s' '[{"TableName":"PrimaryResult","c":"0"}]' | telemetry_count)"

check "large integer count preserved" "42315" \
  "$(printf '%s' '[{"TableName":"PrimaryResult","c":"42315"}]' | telemetry_count)"

check "empty result array -> 0" "0" \
  "$(printf '%s' '[]' | telemetry_count)"

check "missing column -> 0" "0" \
  "$(printf '%s' '[{"TableName":"PrimaryResult"}]' | telemetry_count)"

check "malformed / non-JSON -> 0" "0" \
  "$(printf '%s' 'not json at all' | telemetry_count)"

check "empty string -> 0" "0" \
  "$(printf '%s' '' | telemetry_count)"

check "non-numeric column value -> 0" "0" \
  "$(printf '%s' '[{"c":"NaN"}]' | telemetry_count)"

echo
echo "Ran ${TESTS_RUN} assertions, ${TESTS_FAILED} failed."
if [[ "$TESTS_FAILED" -eq 0 ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
