using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Pins the semantics of <see cref="PostgresMetricsStore.GetCurrentReadingsAsync"/> after the
/// Issue #146 rewrite from <c>SELECT DISTINCT ON</c> to a LATERAL top-1 lookup per device.
/// </summary>
public class CurrentReadingsStoreTests
{
    [Fact]
    public async Task GetCurrentReadingsAsync_ReturnsLatestReadingPerDevice()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_a_battery");
        await SeedDevice(connStr, "epcube_b_battery");

        var t0 = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", t0, 100.0);
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", t0.AddMinutes(1), 150.0);
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", t0.AddMinutes(2), 200.0);
        await SeedReading(connStr, "epcube_b_battery", "battery_power_watts", t0, 50.0);
        await SeedReading(connStr, "epcube_b_battery", "battery_power_watts", t0.AddMinutes(5), 75.0);

        var readings = await store.GetCurrentReadingsAsync("battery_power_watts");

        var byDevice = readings.ToDictionary(r => r.DeviceId);
        Assert.Equal(2, readings.Count);
        Assert.Equal(200.0, byDevice["epcube_a_battery"].Value);
        Assert.Equal(t0.AddMinutes(2).ToUnixTimeSeconds(), byDevice["epcube_a_battery"].Timestamp);
        Assert.Equal(75.0, byDevice["epcube_b_battery"].Value);
        Assert.Equal(t0.AddMinutes(5).ToUnixTimeSeconds(), byDevice["epcube_b_battery"].Timestamp);
    }

    [Fact]
    public async Task GetCurrentReadingsAsync_FiltersByMetric_DoesNotMixMetrics()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_a_battery");

        var t0 = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        // A later reading of a DIFFERENT metric must not appear in the requested metric's result.
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", t0, 100.0);
        await SeedReading(connStr, "epcube_a_battery", "battery_stored_kwh", t0.AddMinutes(10), 7.5);

        var readings = await store.GetCurrentReadingsAsync("battery_power_watts");

        var reading = Assert.Single(readings);
        Assert.Equal(100.0, reading.Value);
    }

    [Fact]
    public async Task GetCurrentReadingsAsync_ReturnsEmpty_WhenMetricHasNoReadings()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_a_battery");

        var readings = await store.GetCurrentReadingsAsync("metric_with_no_data");

        Assert.Empty(readings);
    }

    [Fact]
    public async Task GetCurrentReadingsAsync_OmitsDevicesWithNoReadingForMetric()
    {
        // Device B has no reading for the requested metric, only for another one.
        // The LATERAL JOIN excludes B from the result (inner join semantics).
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_a_battery");
        await SeedDevice(connStr, "epcube_b_battery");

        var t0 = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", t0, 100.0);
        await SeedReading(connStr, "epcube_b_battery", "battery_stored_kwh", t0, 7.5);

        var readings = await store.GetCurrentReadingsAsync("battery_power_watts");

        var reading = Assert.Single(readings);
        Assert.Equal("epcube_a_battery", reading.DeviceId);
    }

    [Fact]
    public async Task GetCurrentReadingsAsync_OmitsOrphanReadingsWithoutDeviceRow()
    {
        // Issue #146: the rewrite intentionally narrows behaviour — readings whose
        // device_id has no corresponding row in the devices table are omitted. This
        // matches dashboard expectations (it always joins against /devices anyway).
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_registered_battery");

        var t0 = new DateTimeOffset(2026, 5, 1, 10, 0, 0, TimeSpan.Zero);
        await SeedReading(connStr, "epcube_registered_battery", "battery_power_watts", t0, 100.0);
        await SeedReading(connStr, "epcube_orphan_battery", "battery_power_watts", t0, 999.0);

        var readings = await store.GetCurrentReadingsAsync("battery_power_watts");

        var reading = Assert.Single(readings);
        Assert.Equal("epcube_registered_battery", reading.DeviceId);
    }

    private static async Task SeedDevice(string connStr, string deviceId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class, status) VALUES ($1, 'storage_battery', 'active') " +
            "ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedReading(string connStr, string deviceId, string metricName, DateTimeOffset timestamp, double value)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO readings (device_id, metric_name, timestamp, value) VALUES ($1, $2, $3, $4)", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(metricName);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }
}
