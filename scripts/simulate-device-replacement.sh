#!/usr/bin/env bash
# simulate-device-replacement.sh
#
# Resets the local DB to simulate a device replacement scenario:
#   1. The "old" device is marked removed at OFFLINE_TIME
#   2. All readings for the "new" device after CUTOFF_TIME are deleted
#   3. Remaining "new" device readings are reassigned to the "old" device
#   4. The "new" device record is deleted
#   5. pending_replacements is cleared
#
# After running this, restart the exporter so it rediscovers the "new" device
# and triggers the replacement detection flow.
#
# Usage:
#   ./scripts/simulate-device-replacement.sh [OLD_ID] [NEW_ID]
#
# Defaults (if no args):
#   OLD_ID=5488  NEW_ID=5840
#
# Times are computed automatically:
#   OFFLINE_TIME = 1h6m before script run time (when old device "went offline")
#   CUTOFF_TIME  = 1h6m before script run time (delete new-device readings after this)

set -euo pipefail

OLD_ID="${1:-5488}"
NEW_ID="${2:-5840}"

# Compute times: 1 hour 6 minutes before now
OFFLINE_TIME_UTC="$(date -u -v-1H -v-6M '+%Y-%m-%d %H:%M:%S+00:00')"
CUTOFF_TIME_UTC="${OFFLINE_TIME_UTC}"

OLD_BAT="epcube${OLD_ID}_battery"
OLD_SOL="epcube${OLD_ID}_solar"
NEW_BAT="epcube${NEW_ID}_battery"
NEW_SOL="epcube${NEW_ID}_solar"

COMPOSE_FILE="local/docker-compose.prod-local.yml"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Simulate Device Replacement ==="
echo "  Old device: ${OLD_ID} (${OLD_BAT}, ${OLD_SOL})"
echo "  New device: ${NEW_ID} (${NEW_BAT}, ${NEW_SOL})"
echo "  Offline at: ${OFFLINE_TIME_UTC}"
echo "  Cutoff:     ${CUTOFF_TIME_UTC}"
echo ""

PSQL="docker compose -f ${COMPOSE_FILE} exec -T postgres psql -U epcube -d epcubegraph"

echo "Stopping exporter to prevent discovery races..."
docker compose -f "${COMPOSE_FILE}" stop epcube-exporter

echo "--- Before ---"
$PSQL -c "SELECT device_id, status, updated_at FROM devices WHERE device_id IN ('${OLD_BAT}','${OLD_SOL}','${NEW_BAT}','${NEW_SOL}') ORDER BY device_id;"
$PSQL -c "SELECT device_id, COUNT(*) AS readings, MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM readings WHERE device_id IN ('${OLD_BAT}','${OLD_SOL}','${NEW_BAT}','${NEW_SOL}') GROUP BY device_id ORDER BY device_id;"

echo ""
echo "Step 1: Delete new-device readings after cutoff (${CUTOFF_TIME_UTC})..."
$PSQL -c "DELETE FROM readings WHERE device_id IN ('${NEW_BAT}','${NEW_SOL}') AND timestamp >= TIMESTAMPTZ '${CUTOFF_TIME_UTC}';"

echo "Step 2: Reassign remaining new-device readings to old device..."
$PSQL -c "UPDATE readings SET device_id = '${OLD_BAT}' WHERE device_id = '${NEW_BAT}';"
$PSQL -c "UPDATE readings SET device_id = '${OLD_SOL}' WHERE device_id = '${NEW_SOL}';"

echo "Step 3: Delete new-device records..."
$PSQL -c "DELETE FROM devices WHERE device_id IN ('${NEW_BAT}','${NEW_SOL}');"

echo "Step 4: Mark old device as removed at ${OFFLINE_TIME_UTC}..."
$PSQL -c "UPDATE devices SET status = 'removed', updated_at = TIMESTAMPTZ '${OFFLINE_TIME_UTC}' WHERE device_id IN ('${OLD_BAT}','${OLD_SOL}');"

echo "Step 5: Clear pending_replacements..."
$PSQL -c "DELETE FROM pending_replacements;"

echo "Step 6: Reset vue_device_mapping key from epcube${NEW_ID} back to epcube${OLD_ID} (if renamed by prior merge)..."
$PSQL -c "UPDATE settings SET value = (
    SELECT jsonb_object_agg(
        CASE WHEN key = 'epcube${NEW_ID}' THEN 'epcube${OLD_ID}' ELSE key END,
        value
    ) FROM jsonb_each(value)
), last_modified = NOW()
WHERE key = 'vue_device_mapping' AND value ? 'epcube${NEW_ID}';"

echo ""
echo "--- After ---"
$PSQL -c "SELECT device_id, status, updated_at FROM devices WHERE device_id LIKE 'epcube${OLD_ID}%' OR device_id LIKE 'epcube${NEW_ID}%' ORDER BY device_id;"
$PSQL -c "SELECT device_id, COUNT(*) AS readings, MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM readings WHERE device_id LIKE 'epcube${OLD_ID}%' OR device_id LIKE 'epcube${NEW_ID}%' GROUP BY device_id ORDER BY device_id;"

echo ""
echo "Starting exporter to trigger discovery..."
docker compose -f "${COMPOSE_FILE}" up -d epcube-exporter
echo "Done."
