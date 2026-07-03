#!/usr/bin/env bash
# infra/lib/telemetry.sh — end-to-end telemetry helpers for validate-deployment.
#
# telemetry_count: read the JSON emitted by
#   az monitor log-analytics query -o json --analytics-query "... | summarize c=count()"
# on stdin and echo the integer row count. Any empty / malformed / missing-column
# result maps to 0 so the caller fails closed — "no telemetry" is treated the same
# as "not flowing" (issue #164, where a green resource-wiring check hid the fact
# that no telemetry was actually landing).
telemetry_count() {
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(0); sys.exit(0)
if not isinstance(d, list) or not d or not isinstance(d[0], dict):
    print(0); sys.exit(0)
try:
    print(int(d[0].get("c", 0)))
except (TypeError, ValueError):
    print(0)
'
}
