using EpCubeGraph.Api.Models;
using Npgsql;

namespace EpCubeGraph.Api.Services;

public sealed class PostgresMetricsStore : IMetricsStore, IDisposable
{
    private readonly NpgsqlDataSource _dataSource;

    public PostgresMetricsStore(string connectionString)
    {
        _dataSource = NpgsqlDataSource.Create(connectionString);
    }

    public async Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(CancellationToken ct = default)
    {
        const string sql = """
            SELECT d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid,
                   CASE WHEN MAX(r.timestamp) > NOW() - INTERVAL '3 minutes' THEN true ELSE false END AS online
            FROM devices d
            LEFT JOIN readings r ON d.device_id = r.device_id
            GROUP BY d.device_id, d.device_class, d.alias, d.manufacturer, d.product_code, d.uid
            ORDER BY d.device_id
            """;

        await using var cmd = _dataSource.CreateCommand(sql);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

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
                Alias: reader.IsDBNull(2) ? null : reader.GetString(2)));
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
}
