using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Unit;

public class VueEndpointsTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public VueEndpointsTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockVueStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose() => _client.Dispose();

    // ── GET /vue/devices ──

    [Fact]
    public async Task GetDevices_ReturnsOk_WithDeviceList()
    {
        // Arrange
        _factory.MockVueStore.DevicesResult = new[]
        {
            new VueDeviceInfo(12345, "Main Panel", "Main Panel", Connected: true, Channels: new[]
            {
                new VueDeviceChannel("1,2,3", "Main", "Main"),
                new VueDeviceChannel("1", "Kitchen", "Kitchen"),
            })
        };

        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, doc.RootElement.GetProperty("devices").GetArrayLength());
        var dev = doc.RootElement.GetProperty("devices")[0];
        Assert.Equal(12345, dev.GetProperty("device_gid").GetInt64());
        Assert.Equal("Main Panel", dev.GetProperty("display_name").GetString());
        Assert.Equal(2, dev.GetProperty("channels").GetArrayLength());
    }

    [Fact]
    public async Task GetDevices_ReturnsEmptyArray_WhenNoDevices()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    // ── GET /vue/devices/{gid}/readings/current ──

    [Fact]
    public async Task GetCurrentReadings_ReturnsOk_WithChannelData()
    {
        // Arrange
        _factory.MockVueStore.CurrentReadingsResult = new VueCurrentReadingsResponse(
            12345, 1712592000, new[]
            {
                new VueChannelReading("1,2,3", "Main", 8450.5),
                new VueChannelReading("1", "Kitchen", 1200.0),
            });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices/12345/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(12345, doc.RootElement.GetProperty("device_gid").GetInt64());
        Assert.Equal(2, doc.RootElement.GetProperty("channels").GetArrayLength());
    }

    [Fact]
    public async Task GetCurrentReadings_Returns404_WhenNoData()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices/99999/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── GET /vue/panels/{gid}/total ──

    [Fact]
    public async Task GetPanelTotal_ReturnsRawAndDeduplicated()
    {
        // Arrange
        _factory.MockVueStore.PanelTotalResult = new PanelTotalResponse(
            12345, "Main Panel", 1712592000,
            RawTotalWatts: 8450.5,
            DeduplicatedTotalWatts: 5230.5,
            Children: new[]
            {
                new PanelChild(23456, "Workshop", 3220.0)
            });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/panels/12345/total");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(8450.5, doc.RootElement.GetProperty("raw_total_watts").GetDouble());
        Assert.Equal(5230.5, doc.RootElement.GetProperty("deduplicated_total_watts").GetDouble());
        Assert.Equal(1, doc.RootElement.GetProperty("children").GetArrayLength());
    }

    [Fact]
    public async Task GetPanelTotal_DeduplicatedEqualsRaw_WhenNoChildren()
    {
        // Arrange
        _factory.MockVueStore.PanelTotalResult = new PanelTotalResponse(
            23456, "Workshop", 1712592000,
            RawTotalWatts: 3220.0,
            DeduplicatedTotalWatts: 3220.0,
            Children: Array.Empty<PanelChild>());

        // Act
        var response = await _client.GetAsync("/api/v1/vue/panels/23456/total");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            doc.RootElement.GetProperty("raw_total_watts").GetDouble(),
            doc.RootElement.GetProperty("deduplicated_total_watts").GetDouble());
        Assert.Equal(0, doc.RootElement.GetProperty("children").GetArrayLength());
    }

    [Fact]
    public async Task GetPanelTotal_Returns404_WhenNoMainsData()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/panels/99999/total");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── GET /vue/home/total ──

    [Fact]
    public async Task GetHomeTotal_ReturnsSumOfTopLevelPanels()
    {
        // Arrange
        _factory.MockVueStore.HomeTotalResult = new HomeTotalResponse(
            1712592000, 11670.5, new[]
            {
                new PanelChild(12345, "Main Panel", 8450.5),
                new PanelChild(34567, "Subpanel 2", 3220.0),
            });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/home/total");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(11670.5, doc.RootElement.GetProperty("total_watts").GetDouble());
        Assert.Equal(2, doc.RootElement.GetProperty("panels").GetArrayLength());
    }

    [Fact]
    public async Task GetHomeTotal_ReturnsZero_WhenNoPanels()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/home/total");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, doc.RootElement.GetProperty("total_watts").GetDouble());
    }

    // ── GET /vue/devices/{gid}/readings/range ──

    [Fact]
    public async Task GetRangeReadings_ReturnsOk_WithSeries()
    {
        // Arrange
        _factory.MockVueStore.RangeReadingsResult = new VueRangeReadingsResponse(
            12345, "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "5s",
            new[]
            {
                new VueChannelSeries("1,2,3", "Main", new[] { new TimeSeriesPoint(1735689600, 8450.5) }),
                new VueChannelSeries("1", "Kitchen", new[] { new TimeSeriesPoint(1735689600, 1200.0) }),
            });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices/12345/readings/range?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(12345, doc.RootElement.GetProperty("device_gid").GetInt64());
        Assert.Equal("5s", doc.RootElement.GetProperty("step").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("series").GetArrayLength());
        var series0 = doc.RootElement.GetProperty("series")[0];
        Assert.Equal("1,2,3", series0.GetProperty("channel_num").GetString());
        Assert.Equal("Main", series0.GetProperty("display_name").GetString());
        Assert.Equal(1, series0.GetProperty("values").GetArrayLength());
    }

    [Fact]
    public async Task GetRangeReadings_Returns404_WhenNoData()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/devices/99999/readings/range?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── GET /vue/panels/{gid}/total/range ──

    [Fact]
    public async Task GetPanelTotalRange_ReturnsOk_WithTimeSeries()
    {
        // Arrange
        _factory.MockVueStore.PanelTotalRangeResult = new PanelTotalRangeResponse(
            12345, "Main Panel", "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "5s",
            RawTotal: new[] { new TimeSeriesPoint(1735689600, 8000.0) },
            DeduplicatedTotal: new[] { new TimeSeriesPoint(1735689600, 5000.0) });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/panels/12345/total/range?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(12345, doc.RootElement.GetProperty("device_gid").GetInt64());
        Assert.Equal(1, doc.RootElement.GetProperty("raw_total").GetArrayLength());
        Assert.Equal(1, doc.RootElement.GetProperty("deduplicated_total").GetArrayLength());
        Assert.Equal(8000.0, doc.RootElement.GetProperty("raw_total")[0].GetProperty("value").GetDouble());
        Assert.Equal(5000.0, doc.RootElement.GetProperty("deduplicated_total")[0].GetProperty("value").GetDouble());
    }

    [Fact]
    public async Task GetPanelTotalRange_Returns404_WhenNoData()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/vue/panels/99999/total/range?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── GET /vue/home/total/range ──

    [Fact]
    public async Task GetHomeTotalRange_ReturnsOk_WithTimeSeries()
    {
        // Arrange
        _factory.MockVueStore.HomeTotalRangeResult = new HomeTotalRangeResponse(
            "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "5s",
            new[] { new TimeSeriesPoint(1735689600, 11000.0) });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/home/total/range?start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("5s", doc.RootElement.GetProperty("step").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("total").GetArrayLength());
    }
}
