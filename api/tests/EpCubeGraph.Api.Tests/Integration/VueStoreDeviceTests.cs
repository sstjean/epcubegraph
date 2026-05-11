using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreDeviceTests
{
    [Fact]
    public async Task GetDevices_ReturnsEmptyWhenNoDevices()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Empty(devices);
    }

    [Fact]
    public async Task GetDevices_ReturnsDeviceWithChannels()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100001, "Main Panel");
        await SeedVueChannel(connStr, 100001, "1,2,3", "Main");
        await SeedVueChannel(connStr, 100001, "1", "Kitchen");

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Single(devices);
        Assert.Equal(100001, devices[0].DeviceGid);
        Assert.Equal("Main Panel", devices[0].DisplayName);
        Assert.NotNull(devices[0].Channels);
        Assert.Equal(2, devices[0].Channels!.Count);
    }

    [Fact]
    public async Task GetDevices_ResolvesDisplayNameOverride()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100002, "Device Raw Name");
        await SeedVueChannel(connStr, 100002, "1", "RawChannel");
        await SeedDisplayNameOverride(connStr, 100002, null, "Custom Device Name");
        await SeedDisplayNameOverride(connStr, 100002, "1", "Custom Channel Name");

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        var device = Assert.Single(devices);
        Assert.Equal("Custom Device Name", device.DisplayName);
        Assert.Equal("Custom Channel Name", device.Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevices_BalanceChannelDefaultsToUnmonitoredLoads()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100003, "Panel");
        await SeedVueChannel(connStr, 100003, "Balance", null);

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Equal("Unmonitored loads", devices[0].Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevices_FallsBackToChannelNum()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100004, "Panel");
        await SeedVueChannel(connStr, 100004, "5", null);

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Equal("Channel 5", devices[0].Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevice_ReturnsNullForUnknownGid()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresVueStore(container.GetConnectionString());

        // Act
        var device = await store.GetDeviceAsync(999999);

        // Assert
        Assert.Null(device);
    }

    [Fact]
    public async Task GetDevice_ReturnsMatchingDevice()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        await SeedVueDevice(connStr, 100005, "Workshop");

        // Act
        var device = await store.GetDeviceAsync(100005);

        // Assert
        Assert.NotNull(device);
        Assert.Equal(100005, device.DeviceGid);
    }

    [Fact]
    public async Task GetDevices_FallsBackToDeviceGidWhenNoName()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var connStr = container.GetConnectionString();
        var store = new PostgresVueStore(connStr);
        using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_devices (device_gid, device_name) VALUES (100070, NULL)", conn);
        await cmd.ExecuteNonQueryAsync();

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        var dev = devices.First(d => d.DeviceGid == 100070);
        Assert.Equal("Device 100070", dev.DisplayName);
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
