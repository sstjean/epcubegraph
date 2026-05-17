using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStorePanelTotalTests
{
    [Fact]
    public async Task GetPanelTotal_ReturnsNullWhenNoMainsData()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetPanelTotalAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotal_ReturnsRawEqualsDeduplicatedWhenNoChildren()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100030, "Main Panel");
        await SeedVueChannel(connStr, 100030, "1,2,3", "Main");
        await SeedVueReading(connStr, 100030, "1,2,3", DateTimeOffset.UtcNow, 8000.0);

        // Act
        var result = await store.GetPanelTotalAsync(100030);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(8000.0, result.RawTotalWatts);
        Assert.Equal(8000.0, result.DeduplicatedTotalWatts);
        Assert.Empty(result.Children);
    }

    [Fact]
    public async Task GetPanelTotal_SubtractsChildrenForDeduplication()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100031, "Main Panel");
        await SeedVueDevice(connStr, 100032, "Sub Panel");
        await SeedVueChannel(connStr, 100031, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100032, "1,2,3", "Sub Main");
        await SeedPanelHierarchy(connStr, 100031, 100032);

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100031, "1,2,3", now, 8000.0);
        await SeedVueReading(connStr, 100032, "1,2,3", now, 3000.0);

        // Act
        var result = await store.GetPanelTotalAsync(100031);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(8000.0, result.RawTotalWatts);
        Assert.Equal(5000.0, result.DeduplicatedTotalWatts);
        Assert.Single(result.Children);
        Assert.Equal(100032, result.Children[0].DeviceGid);
        Assert.Equal(3000.0, result.Children[0].RawTotalWatts);
    }

    [Fact]
    public async Task GetPanelTotalRange_ReturnsNullWhenNoData()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetPanelTotalRangeAsync(
            999999, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotalRange_ReturnsRawAndDeduplicatedSeries()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100040, "Main Panel");
        await SeedVueDevice(connStr, 100041, "Sub Panel");
        await SeedVueChannel(connStr, 100040, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100041, "1,2,3", "Sub Main");
        await SeedPanelHierarchy(connStr, 100040, 100041);

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await SeedVueReading(connStr, 100040, "1,2,3", start.AddSeconds(30), 8000.0);
        await SeedVueReading(connStr, 100041, "1,2,3", start.AddSeconds(30), 3000.0);

        // Act
        var result = await store.GetPanelTotalRangeAsync(100040, start, now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100040, result.DeviceGid);
        Assert.Equal("1m", result.Step);
        Assert.NotEmpty(result.RawTotal);
        Assert.NotEmpty(result.DeduplicatedTotal);
        Assert.Equal(8000.0, result.RawTotal[0].Value);
        Assert.Equal(5000.0, result.DeduplicatedTotal[0].Value);
    }

    [Fact]
    public async Task GetPanelTotalRange_NoChildrenRawEqualsDeduplicated()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100042, "Solo Panel");
        await SeedVueChannel(connStr, 100042, "1,2,3", "Main");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100042, "1,2,3", now.AddMinutes(-2), 6000.0);

        // Act
        var result = await store.GetPanelTotalRangeAsync(100042, now.AddMinutes(-5), now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(result.RawTotal[0].Value, result.DeduplicatedTotal[0].Value);
    }

    private static async Task SeedVueDevice(string connStr, long gid, string name, bool connected = true, string? model = null)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_devices (device_gid, device_name, model, connected) VALUES ($1, $2, $3, $4) ON CONFLICT (device_gid) DO UPDATE SET device_name = $2, model = $3, connected = $4", conn);
        cmd.Parameters.AddWithValue(gid);
        cmd.Parameters.AddWithValue(name);
        cmd.Parameters.AddWithValue((object?)model ?? DBNull.Value);
        cmd.Parameters.AddWithValue(connected);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedVueChannel(string connStr, long gid, string channelNum, string? name = null, string? channelType = null)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_channels (device_gid, channel_num, name, channel_type) VALUES ($1, $2, $3, $4) ON CONFLICT (device_gid, channel_num) DO UPDATE SET name = $3, channel_type = $4", conn);
        cmd.Parameters.AddWithValue(gid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue((object?)name ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)channelType ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedVueReading(string connStr, long gid, string channelNum, DateTimeOffset timestamp, double value)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_readings (device_gid, channel_num, timestamp, value) VALUES ($1, $2, $3, $4) ON CONFLICT (device_gid, channel_num, timestamp) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(gid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPanelHierarchy(string connStr, long parentGid, long childGid)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO panel_hierarchy (parent_device_gid, child_device_gid) VALUES ($1, $2) ON CONFLICT (parent_device_gid, child_device_gid) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(parentGid);
        cmd.Parameters.AddWithValue(childGid);
        await cmd.ExecuteNonQueryAsync();
    }
}
