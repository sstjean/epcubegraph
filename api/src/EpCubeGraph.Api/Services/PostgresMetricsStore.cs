using EpCubeGraph.Api.Models;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace EpCubeGraph.Api.Services;

public sealed class PostgresMetricsStore : IMetricsStore, IDisposable
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<PostgresMetricsStore> _logger;

    public PostgresMetricsStore(string connectionString, ILogger<PostgresMetricsStore> logger)
    {
        _dataSource = NpgsqlDataSource.Create(connectionString);
        _logger = logger;
    }

    public async Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(CancellationToken ct = default)
    {
        return await GetDevicesAsync(null, ct);
    }

    public async Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(string? status, CancellationToken ct = default)
    {
        var filterStatus = string.IsNullOrEmpty(status) ? "active" : status;

        string sql;
        if (filterStatus == "all")
        {
            sql = """
                SELECT d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid,
                       CASE WHEN MAX(r.timestamp) > NOW() - INTERVAL '3 minutes' THEN true ELSE false END AS online,
                       d.created_at, d.updated_at
                FROM devices d
                LEFT JOIN readings r ON d.device_id = r.device_id
                GROUP BY d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid, d.created_at, d.updated_at
                ORDER BY d.device_id
                """;
            await using var cmdAll = _dataSource.CreateCommand(sql);
            await using var readerAll = await cmdAll.ExecuteReaderAsync(ct);
            return await ReadDeviceInfoList(readerAll, ct);
        }

        sql = """
            SELECT d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid,
                   CASE WHEN MAX(r.timestamp) > NOW() - INTERVAL '3 minutes' THEN true ELSE false END AS online,
                   d.created_at, d.updated_at
            FROM devices d
            LEFT JOIN readings r ON d.device_id = r.device_id
            WHERE d.status = $1
            GROUP BY d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid, d.created_at, d.updated_at
            ORDER BY d.device_id
            """;
        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue(filterStatus);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await ReadDeviceInfoList(reader, ct);
    }

    private static async Task<IReadOnlyList<DeviceInfo>> ReadDeviceInfoList(NpgsqlDataReader reader, CancellationToken ct)
    {
        var devices = new List<DeviceInfo>();
        while (await reader.ReadAsync(ct))
        {
            devices.Add(new DeviceInfo(
                Device: reader.GetString(0),
                DeviceClass: reader.GetString(1),
                Manufacturer: reader.IsDBNull(3) ? null : reader.GetString(3),
                ProductCode: reader.IsDBNull(4) ? null : reader.GetString(4),
                Uid: reader.IsDBNull(5) ? null : reader.GetString(5),
                Online: reader.GetBoolean(6),
                Alias: reader.IsDBNull(2) ? null : reader.GetString(2),
                CreatedAt: reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
                UpdatedAt: reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8)));
        }
        return devices;
    }

    public async Task<IReadOnlyList<string>> GetDeviceMetricsAsync(string deviceId, CancellationToken ct = default)
    {
        const string sql = "SELECT DISTINCT metric_name FROM readings WHERE device_id = $1 ORDER BY metric_name";

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue(deviceId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var metrics = new List<string>();
        while (await reader.ReadAsync(ct))
        {
            metrics.Add(reader.GetString(0));
        }

        return metrics;
    }

    public async Task<IReadOnlyList<Reading>> GetCurrentReadingsAsync(string metricName, CancellationToken ct = default)
    {
        // For each device, get the latest reading for the given metric
        const string sql = """
            SELECT DISTINCT ON (device_id) device_id, EXTRACT(EPOCH FROM timestamp)::bigint, value
            FROM readings
            WHERE metric_name = $1
            ORDER BY device_id, timestamp DESC
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue(metricName);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var readings = new List<Reading>();
        while (await reader.ReadAsync(ct))
        {
            readings.Add(new Reading(
                DeviceId: reader.GetString(0),
                Timestamp: reader.GetInt64(1),
                Value: reader.GetDouble(2)));
        }

        return readings;
    }

    public async Task<IReadOnlyList<TimeSeries>> GetRangeReadingsAsync(
        string metricName, long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default)
    {
        // Time-bucket aggregation: average value per step interval per device
        const string sql = """
            SELECT device_id,
                   EXTRACT(EPOCH FROM date_bin($4::interval, timestamp, '1970-01-01'::timestamptz))::bigint AS bucket,
                   AVG(value) AS avg_value
            FROM readings
            WHERE metric_name = $1
              AND timestamp >= to_timestamp($2)
              AND timestamp < to_timestamp($3)
            GROUP BY device_id, bucket
            ORDER BY device_id, bucket
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue(metricName);
        cmd.Parameters.AddWithValue((double)startEpoch);
        cmd.Parameters.AddWithValue((double)endEpoch);
        cmd.Parameters.AddWithValue(TimeSpan.FromSeconds(stepSeconds));
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        return await ReadTimeSeries(reader, ct);
    }

    public async Task<IReadOnlyList<TimeSeries>> GetGridReadingsAsync(
        long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default)
    {
        // Grid power is stored directly by the exporter as grid_power_watts
        const string sql = """
            SELECT device_id,
                   EXTRACT(EPOCH FROM date_bin($3::interval, timestamp, '1970-01-01'::timestamptz))::bigint AS bucket,
                   AVG(value) AS avg_value
            FROM readings
            WHERE metric_name = 'grid_power_watts'
              AND timestamp >= to_timestamp($1)
              AND timestamp < to_timestamp($2)
            GROUP BY device_id, bucket
            ORDER BY device_id, bucket
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue((double)startEpoch);
        cmd.Parameters.AddWithValue((double)endEpoch);
        cmd.Parameters.AddWithValue(TimeSpan.FromSeconds(stepSeconds));
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        return await ReadTimeSeries(reader, ct);
    }

    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        try
        {
            await using var cmd = _dataSource.CreateCommand("SELECT 1");
            await cmd.ExecuteScalarAsync(ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<IReadOnlyList<PendingReplacement>> GetPendingReplacementsAsync(CancellationToken ct = default)
    {
        const string sql = """
            SELECT pr.id, pr.old_device_id, pr.new_device_id, pr.detected_at,
                   old_d.product_code, old_d.alias, old_d.updated_at,
                   new_d.product_code, new_d.alias, new_d.updated_at
            FROM pending_replacements pr
            LEFT JOIN LATERAL (
                SELECT product_code, alias, updated_at FROM devices
                WHERE device_id LIKE 'epcube' || pr.old_device_id || '_%'
                LIMIT 1
            ) old_d ON true
            LEFT JOIN LATERAL (
                SELECT product_code, alias, updated_at FROM devices
                WHERE device_id LIKE 'epcube' || pr.new_device_id || '_%'
                LIMIT 1
            ) new_d ON true
            ORDER BY pr.detected_at, pr.id
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var results = new List<PendingReplacement>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new PendingReplacement(
                Id: reader.GetInt32(0),
                OldDeviceId: reader.GetString(1),
                NewDeviceId: reader.GetString(2),
                DetectedAt: reader.GetFieldValue<DateTimeOffset>(3),
                OldProductCode: reader.IsDBNull(4) ? null : reader.GetString(4),
                OldAlias: reader.IsDBNull(5) ? null : reader.GetString(5),
                OldLastSeen: reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                NewProductCode: reader.IsDBNull(7) ? null : reader.GetString(7),
                NewAlias: reader.IsDBNull(8) ? null : reader.GetString(8),
                NewLastSeen: reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9)));
        }
        return results;
    }

    public async Task<DismissResponse?> DismissPendingReplacementAsync(int id, CancellationToken ct = default)
    {
        // Single transaction: look up the pending row, delete it, mark old device removed.
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        await using var lookup = new NpgsqlCommand(
            "SELECT old_device_id, new_device_id FROM pending_replacements WHERE id = $1 FOR UPDATE",
            conn, tx);
        lookup.Parameters.AddWithValue(id);

        string oldDeviceId;
        string newDeviceId;
        await using (var reader = await lookup.ExecuteReaderAsync(ct))
        {
            if (!await reader.ReadAsync(ct))
            {
                await reader.CloseAsync();
                await tx.RollbackAsync(ct);
                return null;
            }
            oldDeviceId = reader.GetString(0);
            newDeviceId = reader.GetString(1);
        }

        await using var del = new NpgsqlCommand(
            "DELETE FROM pending_replacements WHERE id = $1", conn, tx);
        del.Parameters.AddWithValue(id);
        await del.ExecuteNonQueryAsync(ct);

        await using var upd = new NpgsqlCommand(
            "UPDATE devices SET status = 'removed', updated_at = NOW() WHERE device_id IN ($1, $2)",
            conn, tx);
        upd.Parameters.AddWithValue($"epcube{oldDeviceId}_battery");
        upd.Parameters.AddWithValue($"epcube{oldDeviceId}_solar");
        await upd.ExecuteNonQueryAsync(ct);

        await tx.CommitAsync(ct);

        return new DismissResponse(true, oldDeviceId, newDeviceId);
    }

    public async Task<MergePreviewResponse?> GetMergePreviewAsync(
        string oldDeviceId, string newDeviceId, CancellationToken ct = default)
    {
        var oldBattery = $"epcube{oldDeviceId}_battery";
        var oldSolar = $"epcube{oldDeviceId}_solar";
        var newBattery = $"epcube{newDeviceId}_battery";
        var newSolar = $"epcube{newDeviceId}_solar";

        await using var conn = await _dataSource.OpenConnectionAsync(ct);

        // Validate both devices exist; load statuses
        await using var statusCmd = new NpgsqlCommand(
            "SELECT device_id, status FROM devices WHERE device_id IN ($1, $2, $3, $4)", conn);
        statusCmd.Parameters.AddWithValue(oldBattery);
        statusCmd.Parameters.AddWithValue(oldSolar);
        statusCmd.Parameters.AddWithValue(newBattery);
        statusCmd.Parameters.AddWithValue(newSolar);

        var statuses = new Dictionary<string, string>();
        await using (var reader = await statusCmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                statuses[reader.GetString(0)] = reader.GetString(1);
            }
        }

        if (!statuses.ContainsKey(oldBattery) || !statuses.ContainsKey(newBattery))
        {
            return null;
        }

        if (statuses[oldBattery] == "merged")
        {
            throw new MergeValidationException($"Old device '{oldDeviceId}' is already merged");
        }
        if (statuses[newBattery] != "active")
        {
            throw new MergeValidationException($"New device '{newDeviceId}' must be active to receive a merge");
        }

        // Cutoff semantics: rows on the old device with timestamp >= the new device's
        // earliest reading are dropped (overlap window discarded in favour of new device);
        // everything strictly before the cutoff is transferred. If the new device has no
        // readings yet, the cutoff is NULL and every old row transfers.
        const string countSql = """
            WITH cutoff AS (
                SELECT MIN(timestamp) AS ts
                FROM readings
                WHERE device_id IN ($3, $4)
            )
            SELECT
                COUNT(*) FILTER (
                    WHERE (SELECT ts FROM cutoff) IS NULL
                       OR r.timestamp < (SELECT ts FROM cutoff)
                ) AS to_transfer,
                COUNT(*) FILTER (
                    WHERE (SELECT ts FROM cutoff) IS NOT NULL
                      AND r.timestamp >= (SELECT ts FROM cutoff)
                ) AS to_skip
            FROM readings r
            WHERE r.device_id IN ($1, $2)
            """;

        await using var cmd = new NpgsqlCommand(countSql, conn);
        cmd.Parameters.AddWithValue(oldBattery);
        cmd.Parameters.AddWithValue(oldSolar);
        cmd.Parameters.AddWithValue(newBattery);
        cmd.Parameters.AddWithValue(newSolar);

        await using var countReader = await cmd.ExecuteReaderAsync(ct);
        if (!await countReader.ReadAsync(ct))
        {
            return new MergePreviewResponse(oldDeviceId, newDeviceId, 0, 0);
        }
        var transfer = countReader.GetInt64(0);
        var skip = countReader.GetInt64(1);
        return new MergePreviewResponse(oldDeviceId, newDeviceId, transfer, skip);
    }

    public async Task<MergeResponse?> ExecuteMergeAsync(
        string oldDeviceId, string newDeviceId, CancellationToken ct = default)
    {
        var oldBattery = $"epcube{oldDeviceId}_battery";
        var oldSolar = $"epcube{oldDeviceId}_solar";
        var newBattery = $"epcube{newDeviceId}_battery";
        var newSolar = $"epcube{newDeviceId}_solar";

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // Lock and validate device statuses
        await using var statusCmd = new NpgsqlCommand(
            "SELECT device_id, status FROM devices WHERE device_id IN ($1, $2, $3, $4) FOR UPDATE",
            conn, tx);
        statusCmd.Parameters.AddWithValue(oldBattery);
        statusCmd.Parameters.AddWithValue(oldSolar);
        statusCmd.Parameters.AddWithValue(newBattery);
        statusCmd.Parameters.AddWithValue(newSolar);

        var statuses = new Dictionary<string, string>();
        await using (var reader = await statusCmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                statuses[reader.GetString(0)] = reader.GetString(1);
            }
        }

        if (!statuses.ContainsKey(oldBattery) || !statuses.ContainsKey(newBattery))
        {
            await tx.RollbackAsync(ct);
            return null;
        }
        if (statuses[oldBattery] == "merged")
        {
            await tx.RollbackAsync(ct);
            throw new MergeValidationException($"Old device '{oldDeviceId}' is already merged");
        }
        if (statuses[newBattery] != "active")
        {
            await tx.RollbackAsync(ct);
            throw new MergeValidationException($"New device '{newDeviceId}' must be active to receive a merge");
        }

        // Cutoff semantics: drop any old-device rows at or after the new device's
        // earliest reading. Skip the delete entirely when the new device has no readings.
        await using var conflictCmd = new NpgsqlCommand("""
            WITH cutoff AS (
                SELECT MIN(timestamp) AS ts
                FROM readings
                WHERE device_id IN ($3, $4)
            )
            DELETE FROM readings
            WHERE device_id IN ($1, $2)
              AND (SELECT ts FROM cutoff) IS NOT NULL
              AND timestamp >= (SELECT ts FROM cutoff)
            """, conn, tx);
        conflictCmd.Parameters.AddWithValue(oldBattery);
        conflictCmd.Parameters.AddWithValue(oldSolar);
        conflictCmd.Parameters.AddWithValue(newBattery);
        conflictCmd.Parameters.AddWithValue(newSolar);
        var conflictsDeleted = await conflictCmd.ExecuteNonQueryAsync(ct);

        // Re-attribute remaining old readings to new device IDs
        await using var transferCmd = new NpgsqlCommand("""
            UPDATE readings
            SET device_id = REPLACE(device_id, $3, $4)
            WHERE device_id IN ($1, $2)
            """, conn, tx);
        transferCmd.Parameters.AddWithValue(oldBattery);
        transferCmd.Parameters.AddWithValue(oldSolar);
        transferCmd.Parameters.AddWithValue($"epcube{oldDeviceId}_");
        transferCmd.Parameters.AddWithValue($"epcube{newDeviceId}_");
        var transferred = await transferCmd.ExecuteNonQueryAsync(ct);

        // Mark old device sub-rows as merged
        await using var markMerged = new NpgsqlCommand(
            "UPDATE devices SET status = 'merged', updated_at = NOW() WHERE device_id IN ($1, $2)",
            conn, tx);
        markMerged.Parameters.AddWithValue(oldBattery);
        markMerged.Parameters.AddWithValue(oldSolar);
        await markMerged.ExecuteNonQueryAsync(ct);

        // Update vue_device_mapping JSON key (rename epcube{old} → epcube{new})
        var oldMappingKey = $"epcube{oldDeviceId}";
        var newMappingKey = $"epcube{newDeviceId}";
        await using var mappingCmd = new NpgsqlCommand("""
            UPDATE settings
            SET value = (
                SELECT jsonb_object_agg(
                    CASE WHEN key = $1 THEN $2 ELSE key END,
                    value
                )
                FROM jsonb_each(value)
            ),
            last_modified = NOW()
            WHERE key = 'vue_device_mapping'
              AND value ? $1
            """, conn, tx);
        mappingCmd.Parameters.AddWithValue(oldMappingKey);
        mappingCmd.Parameters.AddWithValue(newMappingKey);
        var mappingUpdated = await mappingCmd.ExecuteNonQueryAsync(ct);
        if (mappingUpdated > 0)
            _logger.LogInformation("Merge {Old}→{New}: vue_device_mapping key renamed {OldKey}→{NewKey}",
                oldDeviceId, newDeviceId, oldMappingKey, newMappingKey);
        else
            _logger.LogWarning("Merge {Old}→{New}: vue_device_mapping key '{OldKey}' not found — mapping not updated",
                oldDeviceId, newDeviceId, oldMappingKey);

        // Delete any pending replacement record matching this pair
        await using var pendingCmd = new NpgsqlCommand(
            "DELETE FROM pending_replacements WHERE old_device_id = $1 AND new_device_id = $2",
            conn, tx);
        pendingCmd.Parameters.AddWithValue(oldDeviceId);
        pendingCmd.Parameters.AddWithValue(newDeviceId);
        await pendingCmd.ExecuteNonQueryAsync(ct);

        await tx.CommitAsync(ct);

        return new MergeResponse(oldDeviceId, newDeviceId, transferred, conflictsDeleted);
    }

    public void Dispose()
    {
        _dataSource.Dispose();
    }

    private static async Task<IReadOnlyList<TimeSeries>> ReadTimeSeries(
        NpgsqlDataReader reader, CancellationToken ct)
    {
        var seriesMap = new Dictionary<string, List<TimeSeriesPoint>>();

        while (await reader.ReadAsync(ct))
        {
            var deviceId = reader.GetString(0);
            var timestamp = reader.GetInt64(1);
            var value = reader.GetDouble(2);

            if (!seriesMap.TryGetValue(deviceId, out var points))
            {
                points = new List<TimeSeriesPoint>();
                seriesMap[deviceId] = points;
            }

            points.Add(new TimeSeriesPoint(timestamp, value));
        }

        return seriesMap
            .Select(kvp => new TimeSeries(kvp.Key, kvp.Value))
            .ToList();
    }

    public async Task<DeleteDeviceResponse?> DeleteDeviceAsync(string cloudDeviceId, CancellationToken ct = default)
    {
        var battery = $"epcube{cloudDeviceId}_battery";
        var solar = $"epcube{cloudDeviceId}_solar";

        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // Lock and validate device statuses (returns 0 rows if the device doesn't exist)
        await using var statusCmd = new NpgsqlCommand(
            "SELECT device_id, status FROM devices WHERE device_id IN ($1, $2) FOR UPDATE",
            conn, tx);
        statusCmd.Parameters.AddWithValue(battery);
        statusCmd.Parameters.AddWithValue(solar);

        var statuses = new Dictionary<string, string>();
        await using (var reader = await statusCmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                statuses[reader.GetString(0)] = reader.GetString(1);
            }
        }

        if (statuses.Count == 0)
        {
            await tx.RollbackAsync(ct);
            return null;
        }

        // Refuse to delete active devices — they could still be receiving live readings.
        if (statuses.Values.Any(s => s == "active"))
        {
            await tx.RollbackAsync(ct);
            throw new MergeValidationException(
                $"Cannot delete an active device. Device '{cloudDeviceId}' must be 'removed' or 'merged' status to delete.");
        }

        // Delete all readings for either subdevice
        await using var deleteReadings = new NpgsqlCommand(
            "DELETE FROM readings WHERE device_id IN ($1, $2)", conn, tx);
        deleteReadings.Parameters.AddWithValue(battery);
        deleteReadings.Parameters.AddWithValue(solar);
        var readingsDeleted = await deleteReadings.ExecuteNonQueryAsync(ct);

        // Delete pending replacements that reference this device on either side
        await using var deletePending = new NpgsqlCommand(
            "DELETE FROM pending_replacements WHERE old_device_id = $1 OR new_device_id = $1",
            conn, tx);
        deletePending.Parameters.AddWithValue(cloudDeviceId);
        await deletePending.ExecuteNonQueryAsync(ct);

        // Remove vue_device_mapping key if present
        var mappingKey = $"epcube{cloudDeviceId}";
        await using var mappingCmd = new NpgsqlCommand("""
            UPDATE settings
            SET value = value - $1,
                last_modified = NOW()
            WHERE key = 'vue_device_mapping' AND value ? $1
            """, conn, tx);
        mappingCmd.Parameters.AddWithValue(mappingKey);
        var mappingRemoved = await mappingCmd.ExecuteNonQueryAsync(ct);
        if (mappingRemoved > 0)
            _logger.LogInformation("Delete {Cloud}: vue_device_mapping key '{Key}' removed", cloudDeviceId, mappingKey);

        // Delete the device rows themselves
        await using var deleteDevices = new NpgsqlCommand(
            "DELETE FROM devices WHERE device_id IN ($1, $2)", conn, tx);
        deleteDevices.Parameters.AddWithValue(battery);
        deleteDevices.Parameters.AddWithValue(solar);
        await deleteDevices.ExecuteNonQueryAsync(ct);

        await tx.CommitAsync(ct);

        _logger.LogInformation("Deleted device {Cloud}: {ReadingsDeleted} readings removed",
            cloudDeviceId, readingsDeleted);

        return new DeleteDeviceResponse(cloudDeviceId, readingsDeleted);
    }
}
