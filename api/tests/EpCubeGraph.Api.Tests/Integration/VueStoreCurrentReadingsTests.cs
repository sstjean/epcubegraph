using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreCurrentReadingsTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStoreCurrentReadingsTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetCurrentReadings_ReturnsNullWhenNoReadings()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetCurrentReadingsAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetCurrentReadings_ReturnsLatestPerChannel()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100010, "Panel");
        await _fixture.SeedVueChannelAsync(100010, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100010, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100010, "1,2,3", now.AddSeconds(-10), 5000.0);
        await _fixture.SeedVueReadingAsync(100010, "1,2,3", now.AddSeconds(-5), 5500.0);
        await _fixture.SeedVueReadingAsync(100010, "1", now.AddSeconds(-3), 1200.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200001, "Panel A");
        await _fixture.SeedVueDeviceAsync(200002, "Panel B");
        await _fixture.SeedVueChannelAsync(200001, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(200001, "4", "Kitchen");
        await _fixture.SeedVueChannelAsync(200002, "1,2,3", "Main");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(200001, "1,2,3", now.AddSeconds(-5), 8000.0);
        await _fixture.SeedVueReadingAsync(200001, "4", now.AddSeconds(-3), 1200.0);
        await _fixture.SeedVueReadingAsync(200002, "1,2,3", now.AddSeconds(-2), 3000.0);

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
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        Assert.Empty(result.Devices);
    }

    [Fact]
    public async Task GetBulkCurrentReadings_ResolvesDisplayNameOverrides()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200003, "Panel");
        await _fixture.SeedVueChannelAsync(200003, "4", "Raw Name");
        await _fixture.SeedDisplayNameOverrideAsync(200003, "4", "Custom Name");
        await _fixture.SeedVueReadingAsync(200003, "4", DateTimeOffset.UtcNow, 500.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200004, "Empty Panel");

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200005, "Panel C");
        await _fixture.SeedVueChannelAsync(200005, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(200005, "4", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(200005, "1,2,3", now.AddSeconds(-2), 5000.0);
        await _fixture.SeedVueReadingAsync(200005, "4", now.AddSeconds(-60), 800.0);

        // Act
        var result = await store.GetBulkCurrentReadingsAsync();

        // Assert
        var dev = result.Devices.First(d => d.DeviceGid == 200005);
        Assert.Single(dev.Channels);
        Assert.Equal("1,2,3", dev.Channels[0].ChannelNum);
        Assert.Equal(5000.0, dev.Channels[0].Value);
    }
}
