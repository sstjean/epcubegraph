using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreHomeTotalTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStoreHomeTotalTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetHomeTotal_ReturnsZeroWhenNoDevices()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100050, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100051, "Sub Panel");
        await _fixture.SeedVueDeviceAsync(100052, "Other Panel");
        await _fixture.SeedVueChannelAsync(100050, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100051, "1,2,3", "Sub Main");
        await _fixture.SeedVueChannelAsync(100052, "1,2,3", "Other Main");
        await _fixture.SeedPanelHierarchyAsync(100050, 100051);

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100050, "1,2,3", now, 8000.0);
        await _fixture.SeedVueReadingAsync(100051, "1,2,3", now, 3000.0);
        await _fixture.SeedVueReadingAsync(100052, "1,2,3", now, 2000.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100060, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100061, "Other Panel");
        await _fixture.SeedVueChannelAsync(100060, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100061, "1,2,3", "Other");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await _fixture.SeedVueReadingAsync(100060, "1,2,3", start.AddSeconds(30), 5000.0);
        await _fixture.SeedVueReadingAsync(100061, "1,2,3", start.AddSeconds(30), 3000.0);

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
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetHomeTotalRangeAsync(
            DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Empty(result.Total);
    }
}
