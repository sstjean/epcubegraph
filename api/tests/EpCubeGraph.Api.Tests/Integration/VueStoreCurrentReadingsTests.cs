using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreCurrentReadingsTests
{
    [Fact]
    public async Task GetCurrentReadings_ReturnsNullWhenNoReadings()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetCurrentReadingsAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetCurrentReadings_ReturnsLatestPerChannel()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100010, "Panel");
        await SeedVueChannel(connStr, 100010, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100010, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 100010, "1,2,3", now.AddSeconds(-10), 5000.0);
        await SeedVueReading(connStr, 100010, "1,2,3", now.AddSeconds(-5), 5500.0);
        await SeedVueReading(connStr, 100010, "1", now.AddSeconds(-3), 1200.0);

        // Act
        var result = await store.GetCurrentReadingsAsync(100010);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100010, result.DeviceGid);
        Assert.Equal(2, result.Channels.Count);
        var mains = result.Channels.First(c => c.ChannelNum == "1,2,3");
        Assert.Equal(5500.0, mains.Value);
        Assert.Equal("Main", mains.DisplayName);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_ReturnsAllDevicesWithLatestReadings()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200001, "Panel A");
        await SeedVueDevice(connStr, 200002, "Panel B");
        await SeedVueChannel(connStr, 200001, "1,2,3", "Main");
        await SeedVueChannel(connStr, 200001, "4", "Kitchen");
        await SeedVueChannel(connStr, 200002, "1,2,3", "Main");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 200001, "1,2,3", now.AddSeconds(-5), 8000.0);
        await SeedVueReading(connStr, 200001, "4", now.AddSeconds(-3), 1200.0);
        await SeedVueReading(connStr, 200002, "1,2,3", now.AddSeconds(-2), 3000.0);

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        Assert.Equal(2, result.Devices.Count);
        var panelA = result.Devices.First(d => d.DeviceGid == 200001);
        Assert.Equal(2, panelA.Channels.Count);
        var kitchen = panelA.Channels.First(c => c.ChannelNum == "4");
        Assert.Equal(1200.0, kitchen.Value);
        Assert.Equal("Kitchen", kitchen.DisplayName);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_ReturnsEmptyWhenNoDevices()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        Assert.Empty(result.Devices);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_ResolvesDisplayNameOverrides()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200003, "Panel");
        await SeedVueChannel(connStr, 200003, "4", "Raw Name");
        await SeedDisplayNameOverride(connStr, 200003, "4", "Custom Name");
        await SeedVueReading(connStr, 200003, "4", DateTimeOffset.UtcNow, 500.0);

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        var ch = result.Devices[0].Channels.First(c => c.ChannelNum == "4");
        Assert.Equal("Custom Name", ch.DisplayName);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_DeviceWithNoReadingsIncludedWithEmptyChannels()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200004, "Empty Panel");

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        var dev = result.Devices.FirstOrDefault(d => d.DeviceGid == 200004);
        Assert.NotNull(dev);
        Assert.Empty(dev.Channels);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_ExcludesReadingsOlderThan30Seconds()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200005, "Panel C");
        await SeedVueChannel(connStr, 200005, "1,2,3", "Main");
        await SeedVueChannel(connStr, 200005, "4", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        await SeedVueReading(connStr, 200005, "1,2,3", now.AddSeconds(-2), 5000.0);
        await SeedVueReading(connStr, 200005, "4", now.AddSeconds(-60), 800.0);

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        var dev = result.Devices.First(d => d.DeviceGid == 200005);
        Assert.Single(dev.Channels);
        Assert.Equal("1,2,3", dev.Channels[0].ChannelNum);
        Assert.Equal(5000.0, dev.Channels[0].Value);
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

    private static async Task SeedDisplayNameOverride(string connStr, long deviceGid, string? channelNumber, string displayName)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO display_name_overrides (device_gid, channel_number, display_name) VALUES ($1, $2, $3) ON CONFLICT (device_gid, channel_number) DO UPDATE SET display_name = $3", conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue((object?)channelNumber ?? DBNull.Value);
        cmd.Parameters.AddWithValue(displayName);
        await cmd.ExecuteNonQueryAsync();
    }
}
