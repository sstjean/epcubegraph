using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Integration tests for the full merge pipeline: vue_device_mapping key rename,
/// device status transitions, pending_replacement cleanup, validation rules,
/// and pending-replacement enrichment (last_seen fields).
/// </summary>
public class MergeStoreFullTests
{
    // ── vue_device_mapping ──

    [Fact]
    public async Task ExecuteMerge_RenamesVueDeviceMappingKey()
    {
        // Arrange — settings row with key "epcube5488" → should become "epcube5840"
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube5488_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube5488_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube5840_battery", "storage_battery");
        await SeedDevice(connStr, "epcube5840_solar", "home_solar");
        await SeedSetting(connStr, "vue_device_mapping",
            """{"epcube5488": {"gid": 12345, "channels": ["1,2,3"]}, "other": {"gid": 99}}""");

        // Act
        await store.ExecuteMergeAsync("5488", "5840");

        // Assert — old key gone, new key present with same value, other keys untouched
        var mapping = await ReadSettingJson(connStr, "vue_device_mapping");
        Assert.DoesNotContain("epcube5488", mapping);
        Assert.Contains("epcube5840", mapping);
        Assert.Contains("other", mapping);
        Assert.Contains("12345", mapping); // value preserved
    }

    [Fact]
    public async Task ExecuteMerge_CompletesWhenNoVueDeviceMappingExists()
    {
        // Arrange — no settings row at all
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");

        // Act — should not throw
        var result = await store.ExecuteMergeAsync("100", "200");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task ExecuteMerge_CompletesWhenMappingKeyNotPresent()
    {
        // Arrange — settings row exists but key "epcube100" is not in the JSON
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");
        await SeedSetting(connStr, "vue_device_mapping",
            """{"epcube999": {"gid": 77}}""");

        // Act — merge succeeds, mapping unchanged
        var result = await store.ExecuteMergeAsync("100", "200");

        // Assert
        Assert.NotNull(result);
        var mapping = await ReadSettingJson(connStr, "vue_device_mapping");
        Assert.Contains("epcube999", mapping);
        Assert.DoesNotContain("epcube100", mapping);
        Assert.DoesNotContain("epcube200", mapping);
    }

    // ── Device status transitions ──

    [Fact]
    public async Task ExecuteMerge_MarksOldDevicesMerged()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");

        // Act
        await store.ExecuteMergeAsync("100", "200");

        // Assert — old devices now "merged", new devices still "active"
        Assert.Equal("merged", await GetDeviceStatus(connStr, "epcube100_battery"));
        Assert.Equal("merged", await GetDeviceStatus(connStr, "epcube100_solar"));
        Assert.Equal("active", await GetDeviceStatus(connStr, "epcube200_battery"));
        Assert.Equal("active", await GetDeviceStatus(connStr, "epcube200_solar"));
    }

    // ── Pending replacement cleanup ──

    [Fact]
    public async Task ExecuteMerge_DeletesPendingReplacementRow()
    {
        // Arrange — a pending_replacements row for this pair
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");
        await SeedPendingReplacement(connStr, "100", "200");

        // Pre-check
        Assert.Equal(1, await CountPendingReplacements(connStr));

        // Act
        await store.ExecuteMergeAsync("100", "200");

        // Assert — pending row cleaned up
        Assert.Equal(0, await CountPendingReplacements(connStr));
    }

    [Fact]
    public async Task ExecuteMerge_LeavesUnrelatedPendingReplacementRows()
    {
        // Arrange — two pending rows; only the matching one should be deleted
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");
        await SeedPendingReplacement(connStr, "100", "200");
        await SeedPendingReplacement(connStr, "300", "400");

        // Act
        await store.ExecuteMergeAsync("100", "200");

        // Assert — only the unrelated row remains
        Assert.Equal(1, await CountPendingReplacements(connStr));
    }

    // ── Validation rules at DB level ──

    [Fact]
    public async Task ExecuteMerge_ReturnsNull_WhenDevicesDoNotExist()
    {
        // Arrange — no devices seeded
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        // Act
        var result = await store.ExecuteMergeAsync("999", "888");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task ExecuteMerge_ThrowsWhenOldDeviceAlreadyMerged()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "merged");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "merged");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");

        // Act + Assert
        var ex = await Assert.ThrowsAsync<MergeValidationException>(
            () => store.ExecuteMergeAsync("100", "200"));
        Assert.Contains("already merged", ex.Message);
    }

    [Fact]
    public async Task ExecuteMerge_ThrowsWhenNewDeviceNotActive()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery", status: "removed");
        await SeedDevice(connStr, "epcube200_solar", "home_solar", status: "removed");

        // Act + Assert
        var ex = await Assert.ThrowsAsync<MergeValidationException>(
            () => store.ExecuteMergeAsync("100", "200"));
        Assert.Contains("must be active", ex.Message);
    }

    [Fact]
    public async Task GetMergePreview_ReturnsNull_WhenDevicesDoNotExist()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        // Act
        var result = await store.GetMergePreviewAsync("999", "888");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetMergePreview_ThrowsWhenOldDeviceAlreadyMerged()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "merged");
        await SeedDevice(connStr, "epcube100_solar", "home_solar", status: "merged");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");

        // Act + Assert
        var ex = await Assert.ThrowsAsync<MergeValidationException>(
            () => store.GetMergePreviewAsync("100", "200"));
        Assert.Contains("already merged", ex.Message);
    }

    // ── GetPendingReplacements with last_seen ──

    [Fact]
    public async Task GetPendingReplacements_ReturnsLastSeenFromDeviceUpdatedAt()
    {
        // Arrange — devices with known updated_at
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        var oldTs = new DateTimeOffset(2026, 5, 10, 10, 0, 0, TimeSpan.Zero);
        var newTs = new DateTimeOffset(2026, 5, 16, 11, 0, 0, TimeSpan.Zero);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery", status: "removed", updatedAt: oldTs);
        await SeedDevice(connStr, "epcube200_battery", "storage_battery", updatedAt: newTs);
        await SeedPendingReplacement(connStr, "100", "200");

        // Act
        var items = await store.GetPendingReplacementsAsync();

        // Assert
        Assert.Single(items);
        Assert.Equal(oldTs, items[0].OldLastSeen);
        Assert.Equal(newTs, items[0].NewLastSeen);
    }

    [Fact]
    public async Task GetPendingReplacements_ReturnsNullLastSeen_WhenDeviceNotFound()
    {
        // Arrange — pending row references devices that don't exist in devices table
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedPendingReplacement(connStr, "999", "888");

        // Act
        var items = await store.GetPendingReplacementsAsync();

        // Assert
        Assert.Single(items);
        Assert.Null(items[0].OldLastSeen);
        Assert.Null(items[0].NewLastSeen);
        Assert.Null(items[0].OldProductCode);
        Assert.Null(items[0].NewProductCode);
    }

    [Fact]
    public async Task GetPendingReplacements_ReturnsAliasAndProductCode()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery",
            alias: "Kitchen", productCode: "EP Cube (devType=2)", status: "removed");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery",
            alias: "Garage", productCode: "EP Cube (devType=2)");
        await SeedPendingReplacement(connStr, "100", "200");

        // Act
        var items = await store.GetPendingReplacementsAsync();

        // Assert
        Assert.Single(items);
        Assert.Equal("Kitchen", items[0].OldAlias);
        Assert.Equal("Garage", items[0].NewAlias);
        Assert.Equal("EP Cube (devType=2)", items[0].OldProductCode);
        Assert.Equal("EP Cube (devType=2)", items[0].NewProductCode);
    }

    // ── Dismiss integration ──

    [Fact]
    public async Task DismissPendingReplacement_DeletesRowAndMarksOldDeviceRemoved()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        await SeedDevice(connStr, "epcube100_battery", "storage_battery");
        await SeedDevice(connStr, "epcube100_solar", "home_solar");
        await SeedDevice(connStr, "epcube200_battery", "storage_battery");
        await SeedDevice(connStr, "epcube200_solar", "home_solar");
        await SeedPendingReplacement(connStr, "100", "200");
        var pending = await store.GetPendingReplacementsAsync();
        var id = pending[0].Id;

        // Act
        var result = await store.DismissPendingReplacementAsync(id);

        // Assert
        Assert.NotNull(result);
        Assert.True(result!.Dismissed);
        Assert.Equal(0, await CountPendingReplacements(connStr));
        // Dismiss marks old device rows as 'removed'
        Assert.Equal("removed", await GetDeviceStatus(connStr, "epcube100_battery"));
        Assert.Equal("removed", await GetDeviceStatus(connStr, "epcube100_solar"));
        // New device unaffected
        Assert.Equal("active", await GetDeviceStatus(connStr, "epcube200_battery"));
    }

    [Fact]
    public async Task DismissPendingReplacement_ReturnsNull_WhenIdNotFound()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresMetricsStore(connStr, NullLogger<PostgresMetricsStore>.Instance);

        // Act
        var result = await store.DismissPendingReplacementAsync(99999);

        // Assert
        Assert.Null(result);
    }

    // ── Helpers ──

    private static async Task SeedDevice(string connStr, string deviceId, string deviceClass,
        string status = "active", string? alias = null, string? productCode = null,
        DateTimeOffset? updatedAt = null)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO devices (device_id, device_class, status, alias, product_code, updated_at) " +
            "VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW())) ON CONFLICT (device_id) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
        cmd.Parameters.AddWithValue(status);
        cmd.Parameters.AddWithValue((object?)alias ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)productCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)updatedAt ?? DBNull.Value);
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

    private static async Task<string> ReadSettingJson(string connStr, string key)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT value::text FROM settings WHERE key = $1", conn);
        cmd.Parameters.AddWithValue(key);
        var result = await cmd.ExecuteScalarAsync();
        return result?.ToString() ?? throw new InvalidOperationException($"Setting '{key}' not found");
    }

    private static async Task<string> GetDeviceStatus(string connStr, string deviceId)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT status FROM devices WHERE device_id = $1", conn);
        cmd.Parameters.AddWithValue(deviceId);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<long> CountPendingReplacements(string connStr)
    {
        await using var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM pending_replacements", conn);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
