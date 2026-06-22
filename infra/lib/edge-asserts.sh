#!/usr/bin/env bash
# infra/lib/edge-asserts.sh — Application Gateway WAF_v2 edge assertion helpers.
#
# Pure JSON predicates used by validate-deployment.sh to verify the public edge
# (feature 168). Each function reads `az ... -o json` output on stdin and:
#   - exits 0 and prints a one-line reason when the assertion holds, or
#   - exits 1 and prints a one-line reason when it does not.
#
# They never call `az` themselves, so they are unit-testable with inline JSON
# fixtures (see infra/tests/test-edge-asserts.sh). JSON parsing uses python3,
# consistent with the rest of validate-deployment.sh.

# assert_single_public_ip <env_name>
#   stdin: `az network public-ip list -g <rg> -o json` (array)
#   Passes iff exactly one public IP exists and it is the gateway edge
#   (<env>-appgw-pip) — i.e. no compute is directly exposed (SC-002).
assert_single_public_ip() {
  local env_name="$1"
  ENV_NAME="$env_name" python3 -c '
import sys, json, os
env = os.environ["ENV_NAME"]
data = json.load(sys.stdin)
names = [p.get("name", "") for p in data]
expected = env + "-appgw-pip"
if len(names) == 1 and names[0] == expected:
    print("single public IP is the gateway edge: " + names[0])
    sys.exit(0)
print("expected exactly one public IP [" + expected + "], found "
      + str(len(names)) + ": " + ", ".join(names))
sys.exit(1)
'
}

# assert_env_internal
#   stdin: `az containerapp env show -o json`
#   Passes iff the Container Apps environment uses an internal load balancer.
assert_env_internal() {
  python3 -c '
import sys, json
d = json.load(sys.stdin)
props = d.get("properties", d)
internal = props.get("vnetConfiguration", {}).get("internal", False)
if internal is True:
    print("Container Apps environment is internal (no public compute IP)")
    sys.exit(0)
print("Container Apps environment is NOT internal (internal=" + str(internal) + ")")
sys.exit(1)
'
}

# assert_waf_prevention_owasp
#   stdin: `az network application-gateway waf-policy show -o json`
#   Passes iff the policy is Enabled, in Prevention mode, with a managed OWASP
#   ruleset attached (SC-003). Tolerates the flattened (no "properties") shape.
assert_waf_prevention_owasp() {
  python3 -c '
import sys, json
d = json.load(sys.stdin)
root = d.get("properties", d)
settings = root.get("policySettings", {})
mode = settings.get("mode", "")
state = settings.get("state", "")
rule_sets = root.get("managedRules", {}).get("managedRuleSets", [])
has_owasp = any(rs.get("ruleSetType", "") == "OWASP" for rs in rule_sets)
if mode == "Prevention" and state == "Enabled" and has_owasp:
    print("WAF policy: OWASP managed ruleset, Enabled, Prevention mode")
    sys.exit(0)
print("WAF policy not compliant (mode=" + mode + ", state=" + state
      + ", owasp=" + str(has_owasp) + ")")
sys.exit(1)
'
}

# assert_edge_health
#   stdin: `az network application-gateway show-backend-health -o json`
#   Passes iff at least one backend server exists and every server is Healthy
#   (the edge can actually serve the public health smoke tests — SC-004).
assert_edge_health() {
  python3 -c '
import sys, json
d = json.load(sys.stdin)
servers = []
for pool in d.get("backendAddressPools", []):
    for coll in pool.get("backendHttpSettingsCollection", []):
        servers.extend(coll.get("servers", []))
if not servers:
    print("no backend servers reported by the gateway")
    sys.exit(1)
unhealthy = [s.get("address", "?") for s in servers if s.get("health") != "Healthy"]
if unhealthy:
    print("unhealthy gateway backends: " + ", ".join(unhealthy))
    sys.exit(1)
print("all " + str(len(servers)) + " gateway backend server(s) Healthy")
sys.exit(0)
'
}

# assert_fqdn_is_edge <expected_public_host> <actual_fqdn>
#   Passes iff the api/exporter output FQDN equals the gateway public host,
#   i.e. the public outputs were repointed off the internal app FQDN (FR-009).
assert_fqdn_is_edge() {
  local expected="$1" actual="$2"
  if [[ "$actual" == "$expected" ]]; then
    echo "FQDN resolves to the gateway edge host: $actual"
    return 0
  fi
  echo "FQDN not repointed to the edge (expected [$expected], got [$actual])"
  return 1
}
