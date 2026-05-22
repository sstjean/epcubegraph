using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Verifies that GetDevicesAsync correctly computes the <c>online</c> field
/// based on whether the device has any reading within the last 3 minutes.
///
/// Issue #146: the original implementation used <c>LEFT JOIN readings ... MAX(timestamp)</c>
/// which scans every reading for every device. The rewrite uses an EXISTS subquery
/// that short-circuits on the first qualifying row. These tests pin the semantics
/// so the rewrite is behaviourally equivalent.
/// </summary>
public class DevicesOnlineFieldTests
{
    [Fact]
    public async Task GetDevicesAsync_OnlineTrue_WhenDeviceHasRecentReading()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_recent_battery", "storage_battery", "active");
        await SeedReading(connStr, "epcube_recent_battery", "battery_power_watts", DateTimeOffset.UtcNow.AddSeconds(-30), 100.0);

        var devices = await store.GetDevicesAsync();

        var device = Assert.Single(devices);
        Assert.True(device.Online);
    }

    [Fact]
    public async Task GetDevicesAsync_OnlineFalse_WhenLatestReadingIsOlderThanThreeMinutes()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_stale_battery", "storage_battery", "active");
        await SeedReading(connStr, "epcube_stale_battery", "battery_power_watts", DateTimeOffset.UtcNow.AddMinutes(-10), 50.0);

        var devices = await store.GetDevicesAsync();

        var device = Assert.Single(devices);
        Assert.False(device.Online);
    }

    [Fact]
    public async Task GetDevicesAsync_OnlineFalse_WhenDeviceHasNoReadings()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_noreadings_battery", "storage_battery", "active");

        var devices = await store.GetDevicesAsync();

        var device = Assert.Single(devices);
        Assert.False(device.Online);
    }

    [Fact]
    public async Task GetDevicesAsync_OnlineTrue_WhenAnyMetricHasRecentReading()
    {
        // The exporter writes multiple metrics per device. "Online" only requires
        // ANY metric to be recent. Old readings from one metric must not mask a
        // fresh reading from another.
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_mixed_battery", "storage_battery", "active");
        await SeedReading(connStr, "epcube_mixed_battery", "battery_power_watts", DateTimeOffset.UtcNow.AddDays(-1), 50.0);
        await SeedReading(connStr, "epcube_mixed_battery", "battery_stored_kwh", DateTimeOffset.UtcNow.AddSeconds(-10), 7.5);

        var devices = await store.GetDevicesAsync();

        var device = Assert.Single(devices);
        Assert.True(device.Online);
    }

    [Fact]
    public async Task GetDevicesAsync_AllStatuses_ComputesOnlineCorrectly()
    {
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube_a_battery", "storage_battery", "active");
        await SeedReading(connStr, "epcube_a_battery", "battery_power_watts", DateTimeOffset.UtcNow.AddSeconds(-30), 100.0);

        await SeedDevice(connStr, "epcube_b_battery", "storage_battery", "removed");
        await SeedReading(connStr, "epcube_b_battery", "battery_power_watts", DateTimeOffset.UtcNow.AddHours(-1), 50.0);

        var devices = await store.GetDevicesAsync("all");
        var byId = devices.ToDictionary(d => d.Device);

        Assert.True(byId["epcube_a_battery"].Online);
        Assert.False(byId["epcube_b_battery"].Online);
    }

    private static async Task SeedDevice(string connStr, string deviceId, string deviceClass, string status)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class, status) VALUES ($1, $2, $3) " +
            "ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
        cmd.Parameters.AddWithValue(status);
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
