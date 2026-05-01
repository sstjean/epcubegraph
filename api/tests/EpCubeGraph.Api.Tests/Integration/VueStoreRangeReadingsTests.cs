using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStoreRangeReadingsTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStoreRangeReadingsTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetRangeReadings_ReturnsNullWhenNoData()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100020, "Panel");
        await _fixture.SeedVueChannelAsync(100020, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(10), 100.0);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(20), 200.0);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(30), 300.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100021, "Panel");
        await _fixture.SeedVueChannelAsync(100021, "1", "Load");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100021, "1", now.AddMinutes(-10), 500.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100022, "Panel");
        await _fixture.SeedVueChannelAsync(100022, "1", "Kitchen");
        await _fixture.SeedVueChannelAsync(100022, "2", "Bedroom");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100022, "1", now.AddSeconds(-30), 100.0);
        await _fixture.SeedVueReadingAsync(100022, "2", now.AddSeconds(-30), 200.0);

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
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100023, "Panel");
        await _fixture.SeedVueChannelAsync(100023, "1", "Load");

        var oldTime = DateTimeOffset.UtcNow.AddDays(-10);
        await _fixture.SeedVueReading1MinAsync(100023, "1", oldTime, 750.0);

        // Act
        var result = await store.GetRangeReadingsAsync(100023, oldTime.AddMinutes(-5), oldTime.AddMinutes(5), step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Single(result.Series);
        Assert.NotEmpty(result.Series[0].Values);
    }
}
