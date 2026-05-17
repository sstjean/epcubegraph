using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Verifies that GetDevicesAsync returns each device's updated_at timestamp,
/// which the dashboard uses to display when a device was marked removed.
/// </summary>
public class DevicesUpdatedAtTests
{
    [Fact]
    public async Task GetDevicesAsync_ReturnsUpdatedAtForEachDevice()
    {
        // Arrange — seed a removed device with a known updated_at
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        var removedAt = new DateTimeOffset(2026, 5, 10, 12, 30, 0, TimeSpan.Zero);
        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", "removed", removedAt);

        // Act
        var devices = await store.GetDevicesAsync("removed");

        // Assert
        Assert.Single(devices);
        Assert.Equal(removedAt, devices[0].UpdatedAt);
    }

    [Fact]
    public async Task GetDevicesAsync_ReturnsUpdatedAtForAllStatuses()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        var activeAt = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var removedAt = new DateTimeOffset(2026, 5, 10, 12, 30, 0, TimeSpan.Zero);
        await SeedDevice(connStr, "epcube111_battery", "storage_battery", "active", activeAt);
        await SeedDevice(connStr, "epcube222_battery", "storage_battery", "removed", removedAt);

        // Act
        var devices = await store.GetDevicesAsync("all");

        // Assert
        Assert.Equal(2, devices.Count);
        var byId = devices.ToDictionary(d => d.Device);
        Assert.Equal(activeAt, byId["epcube111_battery"].UpdatedAt);
        Assert.Equal(removedAt, byId["epcube222_battery"].UpdatedAt);
    }

    [Theory]
    [InlineData("active")]
    [InlineData("removed")]
    [InlineData("merged")]
    public async Task GetDevicesAsync_ReturnsStatusFieldOnEachDevice_FilteredQuery(string status)
    {
        // PR #137 review (#5): consumers querying with a status filter
        // legitimately want to know which devices have which status without
        // having to infer from device_id naming. The Status field must be
        // populated regardless of which filter is used.
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        var at = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedDevice(connStr, $"epcube333_battery", "storage_battery", status, at);

        var devices = await store.GetDevicesAsync(status);

        Assert.Single(devices);
        Assert.Equal(status, devices[0].Status);
    }

    [Fact]
    public async Task GetDevicesAsync_ReturnsStatusFieldOnEachDevice_AllStatuses()
    {
        // status=all must include the field so callers can distinguish
        // active vs. removed vs. merged in a single response.
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        var at = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedDevice(connStr, "epcube111_battery", "storage_battery", "active", at);
        await SeedDevice(connStr, "epcube222_battery", "storage_battery", "removed", at);
        await SeedDevice(connStr, "epcube333_battery", "storage_battery", "merged", at);

        var devices = await store.GetDevicesAsync("all");
        var byId = devices.ToDictionary(d => d.Device);

        Assert.Equal("active", byId["epcube111_battery"].Status);
        Assert.Equal("removed", byId["epcube222_battery"].Status);
        Assert.Equal("merged", byId["epcube333_battery"].Status);
    }

    private static async Task SeedDevice(string connStr, string deviceId, string deviceClass, string status, DateTimeOffset updatedAt)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class, status, updated_at) VALUES ($1, $2, $3, $4) " +
            "ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
        cmd.Parameters.AddWithValue(status);
        cmd.Parameters.AddWithValue(updatedAt);
        await cmd.ExecuteNonQueryAsync();
    }
}
