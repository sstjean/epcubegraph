using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Real-Postgres tests for the cutoff-based merge semantics introduced after
/// the device-discovery feature. The contract: any old-device reading whose
/// timestamp is at or after the new device's earliest reading is dropped;
/// everything strictly before the cutoff is re-attributed to the new device.
/// If the new device has no readings yet, every old reading transfers.
/// </summary>
public class MergeStoreCutoffTests
{
    [Fact]
    public async Task ExecuteMerge_DropsOldReadingsAtOrAfterCutoff_TransfersOnlyEarlier()
    {
        // Arrange — old=5488 active 09:00, 10:00, 11:00; new=5840 starts 10:00
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);
        await SeedDevice(connStr, "epcube5488_battery", "storage_battery");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar");
        await SeedDevice(connStr, "epcube5840_battery", "storage_battery");
        await SeedDevice(connStr, "epcube5840_solar", "home_solar");

        var t9 = new DateTimeOffset(2026, 5, 10, 9, 0, 0, TimeSpan.Zero);
        var t10 = new DateTimeOffset(2026, 5, 10, 10, 0, 0, TimeSpan.Zero);
        var t11 = new DateTimeOffset(2026, 5, 10, 11, 0, 0, TimeSpan.Zero);

        // Old device: three readings each across two metrics
        await SeedReading(connStr, "epcube5488_battery", "soc", t9, 50);
        await SeedReading(connStr, "epcube5488_battery", "soc", t10, 60);
        await SeedReading(connStr, "epcube5488_battery", "soc", t11, 70);
        await SeedReading(connStr, "epcube5488_solar", "kw", t9, 1.0);
        await SeedReading(connStr, "epcube5488_solar", "kw", t10, 1.5);
        await SeedReading(connStr, "epcube5488_solar", "kw", t11, 2.0);

        // New device: two readings starting at t10 (cutoff)
        await SeedReading(connStr, "epcube5840_battery", "soc", t10, 65);
        await SeedReading(connStr, "epcube5840_battery", "soc", t11, 75);
        await SeedReading(connStr, "epcube5840_solar", "kw", t10, 1.6);
        await SeedReading(connStr, "epcube5840_solar", "kw", t11, 2.1);

        // Act
        var result = await store.ExecuteMergeAsync("5488", "5840");

        // Assert — counts match preview semantics
        Assert.NotNull(result);
        Assert.Equal(4, result!.ConflictsSkipped); // 4 old rows at/after t10 dropped
        Assert.Equal(2, result.ReadingsTransferred); // 2 old rows before t10 transferred

        // Old device IDs no longer have any rows
        Assert.Equal(0, await CountReadings(connStr, "epcube5488_battery"));
        Assert.Equal(0, await CountReadings(connStr, "epcube5488_solar"));

        // New device IDs hold pre-cutoff old rows + original new rows
        Assert.Equal(3, await CountReadings(connStr, "epcube5840_battery")); // t9 transferred + t10/t11 native
        Assert.Equal(3, await CountReadings(connStr, "epcube5840_solar"));

        // Native new-device values at the cutoff timestamp survived (not overwritten)
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT value FROM readings WHERE device_id = 'epcube5840_battery' AND metric_name = 'soc' AND timestamp = $1", conn);
        cmd.Parameters.AddWithValue(t10);
        var v = (double)(await cmd.ExecuteScalarAsync())!;
        Assert.Equal(65, v); // new device's value, not old's 60
    }

    [Fact]
    public async Task ExecuteMerge_TransfersAllOldReadings_WhenNewHasNoReadingsYet()
    {
        // Arrange — new device exists but has zero readings → cutoff is NULL → transfer all
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);
        await SeedDevice(connStr, "epcube100_battery", "storage_battery");
        await SeedDevice(connStr, "epcube100_solar", "home_solar");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");

        var t = new DateTimeOffset(2026, 5, 10, 9, 0, 0, TimeSpan.Zero);
        await SeedReading(connStr, "epcube100_battery", "soc", t, 50);
        await SeedReading(connStr, "epcube100_solar", "kw", t, 1.0);

        // Act
        var result = await store.ExecuteMergeAsync("100", "200");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result!.ReadingsTransferred);
        Assert.Equal(0, result.ConflictsSkipped);
        Assert.Equal(0, await CountReadings(connStr, "epcube100_battery"));
        Assert.Equal(1, await CountReadings(connStr, "epcube200_battery"));
        Assert.Equal(1, await CountReadings(connStr, "epcube200_solar"));
    }

    [Fact]
    public async Task GetMergePreview_ReportsCutoffSplit()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);
        await SeedDevice(connStr, "epcube300_battery", "storage_battery");
        await SeedDevice(connStr, "epcube300_solar", "home_solar");
        await SeedDevice(connStr, "epcube400_battery", "storage_battery");
        await SeedDevice(connStr, "epcube400_solar", "home_solar");

        var t9 = new DateTimeOffset(2026, 5, 10, 9, 0, 0, TimeSpan.Zero);
        var t10 = new DateTimeOffset(2026, 5, 10, 10, 0, 0, TimeSpan.Zero);
        var t11 = new DateTimeOffset(2026, 5, 10, 11, 0, 0, TimeSpan.Zero);

        await SeedReading(connStr, "epcube300_battery", "soc", t9, 1);
        await SeedReading(connStr, "epcube300_battery", "soc", t10, 2);
        await SeedReading(connStr, "epcube300_battery", "soc", t11, 3);
        await SeedReading(connStr, "epcube400_battery", "soc", t10, 9);

        // Act
        var preview = await store.GetMergePreviewAsync("300", "400");

        // Assert — cutoff = t10 → 1 row before (t9), 2 rows at/after (t10, t11)
        Assert.NotNull(preview);
        Assert.Equal(1, preview!.ReadingsToTransfer);
        Assert.Equal(2, preview.ConflictsToSkip);
    }

    private static async Task SeedDevice(string connStr, string deviceId, string deviceClass)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class) VALUES ($1, $2) ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
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

    private static async Task<long> CountReadings(string connStr, string deviceId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT COUNT(*) FROM readings WHERE device_id = $1", conn);
        cmd.Parameters.AddWithValue(deviceId);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
