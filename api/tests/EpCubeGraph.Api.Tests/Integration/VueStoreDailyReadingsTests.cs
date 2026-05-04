using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreDailyReadingsTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStoreDailyReadingsTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetDailyReadings_ReturnsDataForDate()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200010, "Panel");
        await _fixture.SeedVueChannelAsync(200010, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(200010, "4", "Kitchen");

        var date = new DateOnly(2026, 4, 9);
        await _fixture.SeedVueDailyReadingAsync(200010, "1,2,3", date, 42.5);
        await _fixture.SeedVueDailyReadingAsync(200010, "4", date, 3.2);

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
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetDailyReadingsAsync(new DateOnly(2026, 1, 1));

        // Assert
        Assert.Empty(result.Devices);
    }

    [Fact]
    public async Task GetDailyReadings_ResolvesDisplayNameOverrides()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200011, "Panel");
        await _fixture.SeedVueChannelAsync(200011, "4", "Raw Name");
        await _fixture.SeedDisplayNameOverrideAsync(200011, "4", "Custom Daily");

        var date = new DateOnly(2026, 4, 9);
        await _fixture.SeedVueDailyReadingAsync(200011, "4", date, 5.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(200012, "Panel");
        await _fixture.SeedVueChannelAsync(200012, "4", "Load");

        var date1 = new DateOnly(2026, 4, 8);
        var date2 = new DateOnly(2026, 4, 9);
        await _fixture.SeedVueDailyReadingAsync(200012, "4", date1, 10.0);
        await _fixture.SeedVueDailyReadingAsync(200012, "4", date2, 15.0);

        // Act
        var result = await store.GetDailyReadingsAsync(date2);

        // Assert
        Assert.Single(result.Devices);
        Assert.Equal(15.0, result.Devices[0].Channels[0].Kwh);
    }
}
