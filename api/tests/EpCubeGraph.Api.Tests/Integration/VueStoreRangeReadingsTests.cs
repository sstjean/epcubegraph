using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreRangeReadingsTests
{
    [Fact]
    public async Task GetRangeReadings_ReturnsNullWhenNoData()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetRangeReadingsAsync(
            999999, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetRangeReadings_ReturnsBucketedSeries()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100020, "Panel");
        await SeedVueChannel(connStr, 100020, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await SeedVueReading(connStr, 100020, "1", start.AddSeconds(10), 100.0);
        await SeedVueReading(connStr, 100020, "1", start.AddSeconds(20), 200.0);
        await SeedVueReading(connStr, 100020, "1", start.AddSeconds(30), 300.0);

        // Act
        var result = await store.GetRangeReadingsAsync(100020, start, now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100020, result.DeviceGid);
        Assert.Equal("1m", result.Step);
        Assert.Single(result.Series);
        Assert.Equal("1", result.Series[0].ChannelNum);
        Assert.Equal("Kitchen", result.Series[0].DisplayName);
        Assert.NotEmpty(result.Series[0].Values);
    }

    [Fact]
    public async Task GetRangeReadings_AutoResolvesStep()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100021, "Panel");
        await SeedVueChannel(connStr, 100021, "1", "Load");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100021, "1", now.AddMinutes(-10), 500.0);

        // Act
        var result = await store.GetRangeReadingsAsync(100021, now.AddMinutes(-20), now);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("1s", result.Step);
    }

    [Fact]
    public async Task GetRangeReadings_FiltersChannels()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100022, "Panel");
        await SeedVueChannel(connStr, 100022, "1", "Kitchen");
        await SeedVueChannel(connStr, 100022, "2", "Bedroom");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100022, "1", now.AddSeconds(-30), 100.0);
        await SeedVueReading(connStr, 100022, "2", now.AddSeconds(-30), 200.0);

        // Act
        var result = await store.GetRangeReadingsAsync(100022, now.AddMinutes(-1), now, channels: "1");

        // Assert
        Assert.NotNull(result);
        Assert.Single(result.Series);
        Assert.Equal("1", result.Series[0].ChannelNum);
    }

    [Fact]
    public async Task GetRangeReadings_Uses1minTableForOldData()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100023, "Panel");
        await SeedVueChannel(connStr, 100023, "1", "Load");

        var oldTime = DateTimeOffset.UtcNow.AddDays(-10);
        await SeedVueReading1Min(connStr, 100023, "1", oldTime, 750.0);

        // Act
        var result = await store.GetRangeReadingsAsync(100023, oldTime.AddMinutes(-5), oldTime.AddMinutes(5), step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Single(result.Series);
        Assert.NotEmpty(result.Series[0].Values);
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

    private static async Task SeedVueReading1Min(string connStr, long gid, string channelNum, DateTimeOffset timestamp, double value, int sampleCount = 60)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_readings_1min (device_gid, channel_num, timestamp, value, sample_count) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (device_gid, channel_num, timestamp) DO NOTHING", conn);
        cmd.Parameters.AddWithValue(gid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        cmd.Parameters.AddWithValue(sampleCount);
        await cmd.ExecuteNonQueryAsync();
    }
}
