#!/usr/bin/env bash
# Unit test for infra/lib/edge-asserts.sh — the Application Gateway WAF_v2 edge
# post-deployment assertion helpers (feature 168).
#
# These are pure JSON predicates: each reads `az ... -o json` output on stdin
# and exits 0 (assertion holds) or 1 (assertion fails), printing a one-line
# reason. They are unit-tested here with inline fixtures (no live az, no
# stub-az needed — the functions never call az themselves).
#
# Each scenario follows the constitution's Arrange / Act / Assert structure.
#
# Run: bash infra/tests/test-edge-asserts.sh   (exit 0 = all pass, 1 = any fail)

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${TEST_DIR}/../lib/edge-asserts.sh"

# shellcheck source=/dev/null
source "$LIB"

TESTS_RUN=0
TESTS_FAILED=0

# expect_rc <description> <expected_rc> <actual_rc>
expect_rc() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  ok   - $desc"
  else
    echo "  FAIL - $desc (expected rc=$expected, got rc=$actual)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
echo "assert_single_public_ip — exactly one public IP and it is the gateway"
# ---------------------------------------------------------------------------
# Arrange
one_edge_pip='[{"name":"epcubegraph-appgw-pip","ipAddress":"20.1.2.3"}]'
two_pips='[{"name":"epcubegraph-appgw-pip"},{"name":"leftover-pip"}]'
wrong_pip='[{"name":"some-other-pip"}]'
# Act / Assert
assert_single_public_ip "epcubegraph" <<<"$one_edge_pip" >/dev/null
expect_rc "single gateway public IP passes" 0 "$?"
assert_single_public_ip "epcubegraph" <<<"$two_pips" >/dev/null
expect_rc "two public IPs fail (compute still exposed)" 1 "$?"
assert_single_public_ip "epcubegraph" <<<"$wrong_pip" >/dev/null
expect_rc "single non-gateway public IP fails" 1 "$?"

# ---------------------------------------------------------------------------
echo "assert_env_internal — Container Apps env internal load balancer"
# ---------------------------------------------------------------------------
# Arrange
env_internal='{"properties":{"vnetConfiguration":{"internal":true}}}'
env_external='{"properties":{"vnetConfiguration":{"internal":false}}}'
# Act / Assert
assert_env_internal <<<"$env_internal" >/dev/null
expect_rc "internal env passes" 0 "$?"
assert_env_internal <<<"$env_external" >/dev/null
expect_rc "external env fails" 1 "$?"

# ---------------------------------------------------------------------------
echo "assert_waf_prevention_owasp — managed OWASP ruleset in Prevention mode"
# ---------------------------------------------------------------------------
# Arrange
waf_ok='{"properties":{"policySettings":{"mode":"Prevention","state":"Enabled"},"managedRules":{"managedRuleSets":[{"ruleSetType":"OWASP","ruleSetVersion":"3.2"}]}}}'
waf_detection='{"properties":{"policySettings":{"mode":"Detection","state":"Enabled"},"managedRules":{"managedRuleSets":[{"ruleSetType":"OWASP","ruleSetVersion":"3.2"}]}}}'
waf_no_owasp='{"properties":{"policySettings":{"mode":"Prevention","state":"Enabled"},"managedRules":{"managedRuleSets":[{"ruleSetType":"Microsoft_BotManagerRuleSet","ruleSetVersion":"1.0"}]}}}'
# Some az show commands flatten the resource (no "properties" wrapper).
waf_ok_flat='{"policySettings":{"mode":"Prevention","state":"Enabled"},"managedRules":{"managedRuleSets":[{"ruleSetType":"OWASP","ruleSetVersion":"3.2"}]}}'
# Act / Assert
assert_waf_prevention_owasp <<<"$waf_ok" >/dev/null
expect_rc "OWASP + Prevention + Enabled passes" 0 "$?"
assert_waf_prevention_owasp <<<"$waf_ok_flat" >/dev/null
expect_rc "flattened (no properties wrapper) passes" 0 "$?"
assert_waf_prevention_owasp <<<"$waf_detection" >/dev/null
expect_rc "Detection mode fails" 1 "$?"
assert_waf_prevention_owasp <<<"$waf_no_owasp" >/dev/null
expect_rc "no OWASP ruleset fails" 1 "$?"

# ---------------------------------------------------------------------------
echo "assert_edge_health — every gateway backend server reports Healthy"
# ---------------------------------------------------------------------------
# Arrange
health_ok='{"backendAddressPools":[{"backendHttpSettingsCollection":[{"servers":[{"address":"10.0.4.10","health":"Healthy"}]}]}]}'
health_bad='{"backendAddressPools":[{"backendHttpSettingsCollection":[{"servers":[{"address":"10.0.4.10","health":"Healthy"},{"address":"10.0.4.11","health":"Unhealthy"}]}]}]}'
health_empty='{"backendAddressPools":[{"backendHttpSettingsCollection":[{"servers":[]}]}]}'
# Act / Assert
assert_edge_health <<<"$health_ok" >/dev/null
expect_rc "all backends Healthy passes" 0 "$?"
assert_edge_health <<<"$health_bad" >/dev/null
expect_rc "any Unhealthy backend fails" 1 "$?"
assert_edge_health <<<"$health_empty" >/dev/null
expect_rc "no backend servers fails" 1 "$?"

# ---------------------------------------------------------------------------
echo "assert_fqdn_is_edge — api_fqdn output points at the gateway public host"
# ---------------------------------------------------------------------------
# Arrange
expected="api.devsbx.xyz"
# Act / Assert
assert_fqdn_is_edge "$expected" "api.devsbx.xyz" >/dev/null
expect_rc "api_fqdn equals the edge public host passes" 0 "$?"
assert_fqdn_is_edge "$expected" "epcubegraph-api.internal.default_domain" >/dev/null
expect_rc "api_fqdn still pointing at the internal app FQDN fails" 1 "$?"

# ---------------------------------------------------------------------------
echo ""
echo "Ran ${TESTS_RUN} assertions, ${TESTS_FAILED} failed."
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0
