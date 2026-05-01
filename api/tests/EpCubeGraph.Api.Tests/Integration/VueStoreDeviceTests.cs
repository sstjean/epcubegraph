using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreDeviceTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStoreDeviceTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetDevices_ReturnsEmptyWhenNoDevices()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Empty(devices);
    }

    [Fact]
    public async Task GetDevices_ReturnsDeviceWithChannels()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100001, "Main Panel");
        await _fixture.SeedVueChannelAsync(100001, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100001, "1", "Kitchen");

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100002, "Device Raw Name");
        await _fixture.SeedVueChannelAsync(100002, "1", "RawChannel");
        await _fixture.SeedDisplayNameOverrideAsync(100002, null, "Custom Device Name");
        await _fixture.SeedDisplayNameOverrideAsync(100002, "1", "Custom Channel Name");

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100003, "Panel");
        await _fixture.SeedVueChannelAsync(100003, "Balance", null);

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Equal("Unmonitored loads", devices[0].Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevices_FallsBackToChannelNum()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100004, "Panel");
        await _fixture.SeedVueChannelAsync(100004, "5", null);

        // Act
        var devices = await store.GetDevicesAsync();

        // Assert
        Assert.Equal("Channel 5", devices[0].Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevice_ReturnsNullForUnknownGid()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var device = await store.GetDeviceAsync(999999);

        // Assert
        Assert.Null(device);
    }

    [Fact]
    public async Task GetDevice_ReturnsMatchingDevice()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100005, "Workshop");

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
        var store = await ArrangeStoreAsync();
        using var conn = new Npgsql.NpgsqlConnection(_fixture.ConnectionString);
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
}
