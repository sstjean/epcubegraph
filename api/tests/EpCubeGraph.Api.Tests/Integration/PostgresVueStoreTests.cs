using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class PostgresVueStoreTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private readonly PostgresVueStore _store;

    public PostgresVueStoreTests(PostgresFixture fixture)
    {
        _fixture = fixture;
        _store = new PostgresVueStore(fixture.ConnectionString);
    }

    public async Task InitializeAsync() => await _fixture.ClearDataAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ── GetDevicesAsync ──

    [Fact]
    public async Task GetDevices_ReturnsEmptyWhenNoDevices()
    {
        // Act
        var devices = await _store.GetDevicesAsync();

        // Assert
        Assert.Empty(devices);
    }

    [Fact]
    public async Task GetDevices_ReturnsDeviceWithChannels()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100001, "Main Panel");
        await _fixture.SeedVueChannelAsync(100001, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100001, "1", "Kitchen");

        // Act
        var devices = await _store.GetDevicesAsync();

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
        await _fixture.SeedVueDeviceAsync(100002, "Device Raw Name");
        await _fixture.SeedVueChannelAsync(100002, "1", "RawChannel");
        await _fixture.SeedDisplayNameOverrideAsync(100002, null, "Custom Device Name");
        await _fixture.SeedDisplayNameOverrideAsync(100002, "1", "Custom Channel Name");

        // Act
        var devices = await _store.GetDevicesAsync();

        // Assert
        var device = Assert.Single(devices);
        Assert.Equal("Custom Device Name", device.DisplayName);
        Assert.Equal("Custom Channel Name", device.Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevices_BalanceChannelDefaultsToUnmonitoredLoads()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100003, "Panel");
        await _fixture.SeedVueChannelAsync(100003, "Balance", null);

        // Act
        var devices = await _store.GetDevicesAsync();

        // Assert
        Assert.Equal("Unmonitored loads", devices[0].Channels![0].DisplayName);
    }

    [Fact]
    public async Task GetDevices_FallsBackToChannelNum()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100004, "Panel");
        await _fixture.SeedVueChannelAsync(100004, "5", null);

        // Act
        var devices = await _store.GetDevicesAsync();

        // Assert
        Assert.Equal("Channel 5", devices[0].Channels![0].DisplayName);
    }

    // ── GetDeviceAsync ──

    [Fact]
    public async Task GetDevice_ReturnsNullForUnknownGid()
    {
        // Act
        var device = await _store.GetDeviceAsync(999999);

        // Assert
        Assert.Null(device);
    }

    [Fact]
    public async Task GetDevice_ReturnsMatchingDevice()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100005, "Workshop");

        // Act
        var device = await _store.GetDeviceAsync(100005);

        // Assert
        Assert.NotNull(device);
        Assert.Equal(100005, device.DeviceGid);
    }

    // ── GetCurrentReadingsAsync ──

    [Fact]
    public async Task GetCurrentReadings_ReturnsNullWhenNoReadings()
    {
        // Act
        var result = await _store.GetCurrentReadingsAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetCurrentReadings_ReturnsLatestPerChannel()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100010, "Panel");
        await _fixture.SeedVueChannelAsync(100010, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100010, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100010, "1,2,3", now.AddSeconds(-10), 5000.0);
        await _fixture.SeedVueReadingAsync(100010, "1,2,3", now.AddSeconds(-5), 5500.0); // latest
        await _fixture.SeedVueReadingAsync(100010, "1", now.AddSeconds(-3), 1200.0);

        // Act
        var result = await _store.GetCurrentReadingsAsync(100010);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100010, result.DeviceGid);
        Assert.Equal(2, result.Channels.Count);
        var mains = result.Channels.First(c => c.ChannelNum == "1,2,3");
        Assert.Equal(5500.0, mains.Value);
        Assert.Equal("Main", mains.DisplayName);
    }

    // ── GetRangeReadingsAsync ──

    [Fact]
    public async Task GetRangeReadings_ReturnsNullWhenNoData()
    {
        // Act
        var result = await _store.GetRangeReadingsAsync(
            999999, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetRangeReadings_ReturnsBucketedSeries()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100020, "Panel");
        await _fixture.SeedVueChannelAsync(100020, "1", "Kitchen");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(10), 100.0);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(20), 200.0);
        await _fixture.SeedVueReadingAsync(100020, "1", start.AddSeconds(30), 300.0);

        // Act
        var result = await _store.GetRangeReadingsAsync(100020, start, now, step: "1m");

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
        await _fixture.SeedVueDeviceAsync(100021, "Panel");
        await _fixture.SeedVueChannelAsync(100021, "1", "Load");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100021, "1", now.AddMinutes(-10), 500.0);

        // Act — 20-minute range → auto-resolve to 1s
        var result = await _store.GetRangeReadingsAsync(100021, now.AddMinutes(-20), now);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("1s", result.Step);
    }

    [Fact]
    public async Task GetRangeReadings_FiltersChannels()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100022, "Panel");
        await _fixture.SeedVueChannelAsync(100022, "1", "Kitchen");
        await _fixture.SeedVueChannelAsync(100022, "2", "Bedroom");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100022, "1", now.AddSeconds(-30), 100.0);
        await _fixture.SeedVueReadingAsync(100022, "2", now.AddSeconds(-30), 200.0);

        // Act — only request channel 1
        var result = await _store.GetRangeReadingsAsync(100022, now.AddMinutes(-1), now, channels: "1");

        // Assert
        Assert.NotNull(result);
        Assert.Single(result.Series);
        Assert.Equal("1", result.Series[0].ChannelNum);
    }

    [Fact]
    public async Task GetRangeReadings_Uses1minTableForOldData()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100023, "Panel");
        await _fixture.SeedVueChannelAsync(100023, "1", "Load");

        // Seed into 1-min table with old timestamps (>7 days ago)
        var oldTime = DateTimeOffset.UtcNow.AddDays(-10);
        await _fixture.SeedVueReading1MinAsync(100023, "1", oldTime, 750.0);

        // Act — query old range (should hit vue_readings_1min)
        var result = await _store.GetRangeReadingsAsync(100023, oldTime.AddMinutes(-5), oldTime.AddMinutes(5), step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Single(result.Series);
        Assert.NotEmpty(result.Series[0].Values);
    }

    // ── GetPanelTotalAsync ──

    [Fact]
    public async Task GetPanelTotal_ReturnsNullWhenNoMainsData()
    {
        // Act
        var result = await _store.GetPanelTotalAsync(999999);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotal_ReturnsRawEqualsDeduplicatedWhenNoChildren()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100030, "Main Panel");
        await _fixture.SeedVueChannelAsync(100030, "1,2,3", "Main");
        await _fixture.SeedVueReadingAsync(100030, "1,2,3", DateTimeOffset.UtcNow, 8000.0);

        // Act
        var result = await _store.GetPanelTotalAsync(100030);

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
        await _fixture.SeedVueDeviceAsync(100031, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100032, "Sub Panel");
        await _fixture.SeedVueChannelAsync(100031, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100032, "1,2,3", "Sub Main");
        await _fixture.SeedPanelHierarchyAsync(100031, 100032);

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100031, "1,2,3", now, 8000.0);
        await _fixture.SeedVueReadingAsync(100032, "1,2,3", now, 3000.0);

        // Act
        var result = await _store.GetPanelTotalAsync(100031);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(8000.0, result.RawTotalWatts);
        Assert.Equal(5000.0, result.DeduplicatedTotalWatts); // 8000 - 3000
        Assert.Single(result.Children);
        Assert.Equal(100032, result.Children[0].DeviceGid);
        Assert.Equal(3000.0, result.Children[0].RawTotalWatts);
    }

    // ── GetPanelTotalRangeAsync ──

    [Fact]
    public async Task GetPanelTotalRange_ReturnsNullWhenNoData()
    {
        // Act
        var result = await _store.GetPanelTotalRangeAsync(
            999999, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetPanelTotalRange_ReturnsRawAndDeduplicatedSeries()
    {
        // Arrange
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
        var result = await _store.GetPanelTotalRangeAsync(100040, start, now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(100040, result.DeviceGid);
        Assert.Equal("1m", result.Step);
        Assert.NotEmpty(result.RawTotal);
        Assert.NotEmpty(result.DeduplicatedTotal);
        Assert.Equal(8000.0, result.RawTotal[0].Value);
        Assert.Equal(5000.0, result.DeduplicatedTotal[0].Value); // 8000 - 3000
    }

    [Fact]
    public async Task GetPanelTotalRange_NoChildrenRawEqualsDeduplicated()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100042, "Solo Panel");
        await _fixture.SeedVueChannelAsync(100042, "1,2,3", "Main");

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100042, "1,2,3", now.AddMinutes(-2), 6000.0);

        // Act
        var result = await _store.GetPanelTotalRangeAsync(100042, now.AddMinutes(-5), now, step: "1m");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(result.RawTotal[0].Value, result.DeduplicatedTotal[0].Value);
    }

    // ── GetHomeTotalAsync ──

    [Fact]
    public async Task GetHomeTotal_ReturnsZeroWhenNoDevices()
    {
        // Act
        var result = await _store.GetHomeTotalAsync();

        // Assert
        Assert.Equal(0, result.TotalWatts);
        Assert.Empty(result.Panels);
    }

    [Fact]
    public async Task GetHomeTotal_SumsTopLevelPanels()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100050, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100051, "Sub Panel");
        await _fixture.SeedVueDeviceAsync(100052, "Other Panel");
        await _fixture.SeedVueChannelAsync(100050, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100051, "1,2,3", "Sub Main");
        await _fixture.SeedVueChannelAsync(100052, "1,2,3", "Other Main");
        await _fixture.SeedPanelHierarchyAsync(100050, 100051); // Sub is child of Main

        var now = DateTimeOffset.UtcNow;
        await _fixture.SeedVueReadingAsync(100050, "1,2,3", now, 8000.0);
        await _fixture.SeedVueReadingAsync(100051, "1,2,3", now, 3000.0);
        await _fixture.SeedVueReadingAsync(100052, "1,2,3", now, 2000.0);

        // Act
        var result = await _store.GetHomeTotalAsync();

        // Assert — only Main and Other are top-level (Sub excluded)
        Assert.Equal(10000.0, result.TotalWatts); // 8000 + 2000
        Assert.Equal(2, result.Panels.Count);
        Assert.DoesNotContain(result.Panels, p => p.DeviceGid == 100051);
    }

    // ── GetHomeTotalRangeAsync ──

    [Fact]
    public async Task GetHomeTotalRange_ReturnsSummedTimeSeries()
    {
        // Arrange
        await _fixture.SeedVueDeviceAsync(100060, "Main Panel");
        await _fixture.SeedVueDeviceAsync(100061, "Other Panel");
        await _fixture.SeedVueChannelAsync(100060, "1,2,3", "Main");
        await _fixture.SeedVueChannelAsync(100061, "1,2,3", "Other");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5);
        await _fixture.SeedVueReadingAsync(100060, "1,2,3", start.AddSeconds(30), 5000.0);
        await _fixture.SeedVueReadingAsync(100061, "1,2,3", start.AddSeconds(30), 3000.0);

        // Act
        var result = await _store.GetHomeTotalRangeAsync(start, now, step: "1m");

        // Assert
        Assert.NotEmpty(result.Total);
        Assert.Equal(8000.0, result.Total[0].Value); // 5000 + 3000
        Assert.Equal("1m", result.Step);
    }

    [Fact]
    public async Task GetHomeTotalRange_ReturnsEmptyWhenNoDevices()
    {
        // Act
        var result = await _store.GetHomeTotalRangeAsync(
            DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow);

        // Assert
        Assert.Empty(result.Total);
    }

    // ── AutoResolveStep ──

    [Theory]
    [InlineData(10, "1s")]       // 10 min → 1s
    [InlineData(30, "1s")]       // 30 min → 1s
    [InlineData(60, "5s")]       // 1 hr → 5s
    [InlineData(120, "5s")]      // 2 hr → 5s
    [InlineData(300, "15s")]     // 5 hr → 15s
    [InlineData(480, "15s")]     // 8 hr → 15s
    [InlineData(720, "1m")]      // 12 hr → 1m
    [InlineData(1440, "1m")]     // 24 hr → 1m
    [InlineData(4320, "5m")]     // 3 days → 5m
    [InlineData(10080, "5m")]    // 7 days → 5m
    [InlineData(20160, "15m")]   // 14 days → 15m
    [InlineData(43200, "15m")]   // 30 days → 15m
    [InlineData(86400, "1h")]    // 60 days → 1h
    [InlineData(129600, "1h")]   // 90 days → 1h
    [InlineData(259200, "4h")]   // 180 days → 4h
    public void AutoResolveStep_ReturnsCorrectTier(int minutes, string expected)
    {
        // Act
        var result = PostgresVueStore.AutoResolveStep(TimeSpan.FromMinutes(minutes));

        // Assert
        Assert.Equal(expected, result);
    }

    // ── ParseStep ──

    [Theory]
    [InlineData("1s", 1)]
    [InlineData("5s", 5)]
    [InlineData("15s", 15)]
    [InlineData("1m", 60)]
    [InlineData("5m", 300)]
    [InlineData("15m", 900)]
    [InlineData("1h", 3600)]
    [InlineData("4h", 14400)]
    public void ParseStep_ReturnsCorrectTimeSpan(string step, int expectedSeconds)
    {
        // Act
        var result = PostgresVueStore.ParseStep(step);

        // Assert
        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), result);
    }

    [Fact]
    public void ParseStep_DefaultsTo1MinForUnknownSuffix()
    {
        // Act
        var result = PostgresVueStore.ParseStep("1x");

        // Assert
        Assert.Equal(TimeSpan.FromMinutes(1), result);
    }

    // ── Display name resolution: device with no name falls back to "Device {gid}" ──

    [Fact]
    public async Task GetDevices_FallsBackToDeviceGidWhenNoName()
    {
        // Arrange — insert device with null name
        using var conn = new Npgsql.NpgsqlConnection(_fixture.ConnectionString);
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(
            "INSERT INTO vue_devices (device_gid, device_name) VALUES (100070, NULL)", conn);
        await cmd.ExecuteNonQueryAsync();

        // Act
        var devices = await _store.GetDevicesAsync();

        // Assert
        var dev = devices.First(d => d.DeviceGid == 100070);
        Assert.Equal("Device 100070", dev.DisplayName);
    }
}
