using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreDailyReadingsTests
{
    [Fact]
    public async Task GetDailyReadings_ReturnsDataForDate()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200010, "Panel");
        await SeedVueChannel(connStr, 200010, "1,2,3", "Main");
        await SeedVueChannel(connStr, 200010, "4", "Kitchen");

        var date = new DateOnly(2026, 4, 9);
        await SeedVueDailyReading(connStr, 200010, "1,2,3", date, 42.5);
        await SeedVueDailyReading(connStr, 200010, "4", date, 3.2);

        // Act
        var result = await store.GetDailyReadingsAsync(date);

        // Assert
        Assert.Equal("2026-04-09", result.Date);
        Assert.Single(result.Devices);
        Assert.Equal(200010, result.Devices[0].DeviceGid);
        Assert.Equal(2, result.Devices[0].Channels.Count);
        var main = result.Devices[0].Channels.First(c => c.ChannelNum == "1,2,3");
        Assert.Equal(42.5, main.Kwh);
    }

    [Fact]
    public async Task GetDailyReadings_ReturnsEmptyWhenNoDataForDate()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var result = await store.GetDailyReadingsAsync(new DateOnly(2026, 1, 1));

        // Assert
        Assert.Empty(result.Devices);
    }

    [Fact]
    public async Task GetDailyReadings_ResolvesDisplayNameOverrides()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200011, "Panel");
        await SeedVueChannel(connStr, 200011, "4", "Raw Name");
        await SeedDisplayNameOverride(connStr, 200011, "4", "Custom Daily");

        var date = new DateOnly(2026, 4, 9);
        await SeedVueDailyReading(connStr, 200011, "4", date, 5.0);

        // Act
        var result = await store.GetDailyReadingsAsync(date);

        // Assert
        var ch = result.Devices[0].Channels[0];
        Assert.Equal("Custom Daily", ch.DisplayName);
    }

    [Fact]
    public async Task GetDailyReadings_FiltersByDate()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 200012, "Panel");
        await SeedVueChannel(connStr, 200012, "4", "Load");

        var date1 = new DateOnly(2026, 4, 8);
        var date2 = new DateOnly(2026, 4, 9);
        await SeedVueDailyReading(connStr, 200012, "4", date1, 10.0);
        await SeedVueDailyReading(connStr, 200012, "4", date2, 15.0);

        // Act
        var result = await store.GetDailyReadingsAsync(date2);

        // Assert
        Assert.Single(result.Devices);
        Assert.Equal(15.0, result.Devices[0].Channels[0].Kwh);
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

    private static async Task SeedVueDailyReading(string connStr, long gid, string channelNum, DateOnly date, double kwh)
    {
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_readings_daily (device_gid, channel_num, date, kwh) VALUES ($1, $2, $3, $4) ON CONFLICT (device_gid, channel_num, date) DO UPDATE SET kwh = $4, updated_at = NOW()", conn);
        cmd.Parameters.AddWithValue(gid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(date);
        cmd.Parameters.AddWithValue(kwh);
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
