using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueStorePanelTotalTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public VueStorePanelTotalTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresVueStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresVueStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetPanelTotal_ReturnsNullWhenNoMainsData()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetPanelTotalAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotal_ReturnsRawEqualsDeduplicatedWhenNoChildren()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100030, "Main Panel");
        await _fixture.SeedVueChannelAsync(100030, "1,2,3", "Main");
        await _fixture.SeedVueReadingAsync(100030, "1,2,3", DateTimeOffset.UtcNow, 8000.0);

        // Act
        var result = await store.GetPanelTotalAsync(100030);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(8000.0, result.RawTotalWatts);
        Assert.Equal(8000.0, result.DeduplicatedTotalWatts);
        Assert.Empty(result.Children);
    }

    [Fact]
    public async Task GetPanelTotal_SubtractsChildrenForDeduplication()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100031, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100032, "Sub Panel");
        await _fixture.SeedVueChannelAsync(100031, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100032, "1,2,3", "Sub Main");
        await _fixture.SeedPanelHierarchyAsync(100031, 100032);

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100031, "1,2,3", now, 8000.0);
        await _fixture.SeedVueReadingAsync(100032, "1,2,3", now, 3000.0);

        // Act
        var result = await store.GetPanelTotalAsync(100031);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(8000.0, result.RawTotalWatts);
        Assert.Equal(5000.0, result.DeduplicatedTotalWatts);
        Assert.Single(result.Children);
        Assert.Equal(100032, result.Children[0].DeviceGid);
        Assert.Equal(3000.0, result.Children[0].RawTotalWatts);
    }

    [Fact]
    public async Task GetPanelTotalRange_ReturnsNullWhenNoData()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetPanelTotalRangeAsync(
            999999, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotalRange_ReturnsRawAndDeduplicatedSeries()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100040, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100041, "Sub Panel");
        await _fixture.SeedVueChannelAsync(100040, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100041, "1,2,3", "Sub Main");
        await _fixture.SeedPanelHierarchyAsync(100040, 100041);

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await _fixture.SeedVueReadingAsync(100040, "1,2,3", start.AddSeconds(30), 8000.0);
        await _fixture.SeedVueReadingAsync(100041, "1,2,3", start.AddSeconds(30), 3000.0);

        // Act
        var result = await store.GetPanelTotalRangeAsync(100040, start, now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100040, result.DeviceGid);
        Assert.Equal("1m", result.Step);
        Assert.NotEmpty(result.RawTotal);
        Assert.NotEmpty(result.DeduplicatedTotal);
        Assert.Equal(8000.0, result.RawTotal[0].Value);
        Assert.Equal(5000.0, result.DeduplicatedTotal[0].Value);
    }

    [Fact]
    public async Task GetPanelTotalRange_NoChildrenRawEqualsDeduplicated()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await _fixture.SeedVueDeviceAsync(100042, "Solo Panel");
        await _fixture.SeedVueChannelAsync(100042, "1,2,3", "Main");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100042, "1,2,3", now.AddMinutes(-2), 6000.0);

        // Act
        var result = await store.GetPanelTotalRangeAsync(100042, now.AddMinutes(-5), now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(result.RawTotal[0].Value, result.DeduplicatedTotal[0].Value);
    }
}
