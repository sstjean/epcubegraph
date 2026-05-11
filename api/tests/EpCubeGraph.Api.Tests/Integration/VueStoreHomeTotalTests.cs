using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreHomeTotalTests
{
    [Fact]
    public async Task GetHomeTotal_ReturnsZeroWhenNoDevices()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetHomeTotalAsync();

        // Assert
        Assert.Equal(0, result.TotalWatts);
        Assert.Empty(result.Panels);
    }

    [Fact]
    public async Task GetHomeTotal_SumsTopLevelPanels()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100050, "Main Panel");
        await SeedVueDevice(connStr, 100051, "Sub Panel");
        await SeedVueDevice(connStr, 100052, "Other Panel");
        await SeedVueChannel(connStr, 100050, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100051, "1,2,3", "Sub Main");
        await SeedVueChannel(connStr, 100052, "1,2,3", "Other Main");
        await SeedPanelHierarchy(connStr, 100050, 100051);

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100050, "1,2,3", now, 8000.0);
        await SeedVueReading(connStr, 100051, "1,2,3", now, 3000.0);
        await SeedVueReading(connStr, 100052, "1,2,3", now, 2000.0);

        // Act
        var result = await store.GetHomeTotalAsync();

        // Assert
        Assert.Equal(10000.0, result.TotalWatts);
        Assert.Equal(2, result.Panels.Count);
        Assert.DoesNotContain(result.Panels, p => p.DeviceGid == 100051);
    }

    [Fact]
    public async Task GetHomeTotalRange_ReturnsSummedTimeSeries()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100060, "Main Panel");
        await SeedVueDevice(connStr, 100061, "Other Panel");
        await SeedVueChannel(connStr, 100060, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100061, "1,2,3", "Other");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await SeedVueReading(connStr, 100060, "1,2,3", start.AddSeconds(30), 5000.0);
        await SeedVueReading(connStr, 100061, "1,2,3", start.AddSeconds(30), 3000.0);

        // Act
        var result = await store.GetHomeTotalRangeAsync(start, now, step: "1m");

        // Assert
        Assert.NotEmpty(result.Total);
        Assert.Equal(8000.0, result.Total[0].Value);
        Assert.Equal("1m", result.Step);
    }

    [Fact]
    public async Task GetHomeTotalRange_ReturnsEmptyWhenNoDevices()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetHomeTotalRangeAsync(
            DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Empty(result.Total);
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
