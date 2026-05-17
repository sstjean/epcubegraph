using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Real-Postgres tests for PostgresMetricsStore.DeleteDeviceAsync.
/// Hard-deletes a removed/merged device, its readings, related pending_replacements,
/// and any vue_device_mapping entry, in a single transaction.
/// </summary>
public class DeleteDeviceStoreTests
{
    [Fact]
    public async Task DeleteDevice_RemovesDeviceAndAllReadings()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "removed");
        await SeedReading(connStr, "epcube5488_battery", "soc", new DateTimeOffset(2026, 5, 10, 10, 0, 0, TimeSpan.Zero), 50);
        await SeedReading(connStr, "epcube5488_battery", "soc", new DateTimeOffset(2026, 5, 10, 11, 0, 0, TimeSpan.Zero), 55);
        await SeedReading(connStr, "epcube5488_solar", "kw", new DateTimeOffset(2026, 5, 10, 10, 0, 0, TimeSpan.Zero), 1.5);

        // Act
        var result = await store.DeleteDeviceAsync("5488");

        // Assert
        Assert.NotNull(result);
        Assert.Equal("5488", result!.DeviceId);
        Assert.Equal(3, result.ReadingsDeleted);
        Assert.Equal(0, await CountDevices(connStr, "epcube5488_battery"));
        Assert.Equal(0, await CountDevices(connStr, "epcube5488_solar"));
        Assert.Equal(0, await CountReadings(connStr, "epcube5488_battery"));
        Assert.Equal(0, await CountReadings(connStr, "epcube5488_solar"));
    }

    [Fact]
    public async Task DeleteDevice_RemovesPendingReplacementsReferencingDevice()
    {
        // Arrange — pending replacement with this device as both old and new (separate rows)
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "removed");
        await SeedPendingReplacement(connStr, "5488", "5840");
        await SeedPendingReplacement(connStr, "9999", "5488");
        await SeedPendingReplacement(connStr, "1111", "2222"); // unrelated

        // Act
        await store.DeleteDeviceAsync("5488");

        // Assert — both pending rows referencing 5488 are gone, the unrelated row remains
        Assert.Equal(1, await CountPendingReplacements(connStr));
        Assert.Equal(0, await CountPendingReplacementsFor(connStr, "5488"));
    }

    [Fact]
    public async Task DeleteDevice_RemovesVueDeviceMappingKey()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "removed");
        await SeedSetting(connStr, "vue_device_mapping",
            """{"epcube5488": {"gid": 12345}, "epcube3483": {"gid": 99}}""");

        // Act
        await store.DeleteDeviceAsync("5488");

        // Assert
        var mapping = await ReadSettingJson(connStr, "vue_device_mapping");
        Assert.DoesNotContain("epcube5488", mapping);
        Assert.Contains("epcube3483", mapping);
    }

    [Fact]
    public async Task DeleteDevice_AllowsMergedStatus()
    {
        // Arrange — merged devices have transferred their readings; deleting just cleans up the record
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "merged");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "merged");

        // Act
        var result = await store.DeleteDeviceAsync("5488");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(0, await CountDevices(connStr, "epcube5488_battery"));
    }

    [Fact]
    public async Task DeleteDevice_RefusesActiveDevices()
    {
        // Arrange — active devices must not be deletable
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "active");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "active");

        // Act + Assert
        var ex = await Assert.ThrowsAsync<MergeValidationException>(
            () => store.DeleteDeviceAsync("5488"));
        Assert.Contains("active", ex.Message, StringComparison.OrdinalIgnoreCase);
        // Device rows must still exist
        Assert.Equal(1, await CountDevices(connStr, "epcube5488_battery"));
    }

    [Fact]
    public async Task DeleteDevice_ReturnsNullWhenDeviceDoesNotExist()
    {
        // Arrange — empty DB
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        // Act
        var result = await store.DeleteDeviceAsync("99999");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task DeleteDevice_CompletesWhenNoVueDeviceMappingExists()
    {
        // Arrange — no settings row at all
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "removed");

        // Act
        var result = await store.DeleteDeviceAsync("5488");

        // Assert — does not throw, device gone
        Assert.NotNull(result);
        Assert.Equal(0, await CountDevices(connStr, "epcube5488_battery"));
    }

    // ── helpers ──

    private static async Task SeedDevice(string connStr, string deviceId, string deviceClass, string status = "active")
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class, status) VALUES ($1, $2, $3) ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
        cmd.Parameters.AddWithValue(status);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedReading(string connStr, string deviceId, string metric, DateTimeOffset ts, double value)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO readings (device_id, metric_name, timestamp, value) VALUES ($1, $2, $3, $4) " +
            "ON CONFLICT (device_id, metric_name, timestamp) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(metric);
        cmd.Parameters.AddWithValue(ts);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPendingReplacement(string connStr, string oldId, string newId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO pending_replacements (old_device_id, new_device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", conn);
        cmd.Parameters.AddWithValue(oldId);
        cmd.Parameters.AddWithValue(newId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedSetting(string connStr, string key, string jsonValue)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn);
        cmd.Parameters.AddWithValue(key);
        cmd.Parameters.AddWithValue(jsonValue);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<string> ReadSettingJson(string connStr, string key)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT value::text FROM settings WHERE key = $1", conn);
        cmd.Parameters.AddWithValue(key);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountDevices(string connStr, string deviceId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM devices WHERE device_id = $1", conn);
        cmd.Parameters.AddWithValue(deviceId);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountReadings(string connStr, string deviceId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM readings WHERE device_id = $1", conn);
        cmd.Parameters.AddWithValue(deviceId);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountPendingReplacements(string connStr)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM pending_replacements", conn);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountPendingReplacementsFor(string connStr, string cloudId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT COUNT(*) FROM pending_replacements WHERE old_device_id = $1 OR new_device_id = $1", conn);
        cmd.Parameters.AddWithValue(cloudId);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
