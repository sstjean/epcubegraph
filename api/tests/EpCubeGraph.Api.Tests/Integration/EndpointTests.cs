using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Tests for all API endpoint handlers with authentication bypassed
/// and a mock IMetricsStore injected.
/// </summary>
public class EndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public EndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    // ── Health ──

    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        var response = await _client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("healthy", body);
        Assert.Contains("ok", body);
    }

    [Fact]
    public async Task Health_Returns503_WhenDbUnreachable()
    {
        _factory.MockStore.PingResult = false;

        var response = await _client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("unhealthy", body);
        Assert.Contains("unreachable", body);
    }

    // ── Current Readings ──

    [Fact]
    public async Task CurrentReadings_ReturnsOk_WithValidMetric()
    {
        _factory.MockStore.CurrentReadingsResult = new[]
        {
            new Reading("epcube_battery", 1709827200, 42.5)
        };

        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    [Fact]
    public async Task CurrentReadings_ReturnsOk_WithEmptyResult()
    {
        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricMissing()
    {
        var response = await _client.GetAsync("/api/v1/readings/current");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'metric' is required", body);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricEmpty()
    {
        var response = await _client.GetAsync("/api/v1/readings/current?metric=");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricInvalid()
    {
        var response = await _client.GetAsync("/api/v1/readings/current?metric=bad-name!");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("invalid characters", body);
    }

    [Fact]
    public async Task CurrentReadings_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Range Readings ──

    [Fact]
    public async Task RangeReadings_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenMetricMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenEndMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartNotNumeric()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=abc&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepNotPositive()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=-1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepZero()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=0");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Devices ──

    [Fact]
    public async Task Devices_ReturnsOk_WithEmptyList()
    {
        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceData()
    {
        _factory.MockStore.DevicesResult = new[]
        {
            new DeviceInfo("epcube_battery", "storage_battery", "Canadian Solar", "EP Cube 2.0", "ABC123", true, "EP Cube v1 Battery")
        };

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("storage_battery", body);
        Assert.Contains("Canadian Solar", body);
        Assert.Contains("EP Cube v1 Battery", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceMissingOptionalFields()
    {
        _factory.MockStore.DevicesResult = new[]
        {
            new DeviceInfo("epcube_solar", "home_solar")
        };

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_solar", body);
    }

    [Fact]
    public async Task Devices_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Device Metrics ──

    [Fact]
    public async Task DeviceMetrics_ReturnsOk_WithMetrics()
    {
        _factory.MockStore.DeviceMetricsResult = new[]
        {
            "battery_soc", "battery_power"
        };

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("battery_soc", body);
        Assert.Contains("battery_power", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenNoMetrics()
    {
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("not_found", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceInvalid()
    {
        var response = await _client.GetAsync("/api/v1/devices/bad-device!/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Grid ──

    [Fact]
    public async Task Grid_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("grid_power_watts", doc.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithDefaults()
    {
        var response = await _client.GetAsync("/api/v1/grid");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartInvalid()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=not-a-time&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepInvalid()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Bulk Vue Current Readings (Feature 007) ──

    [Fact]
    public async Task BulkCurrentReadings_ReturnsOk()
    {
        // Arrange
        _factory.MockVueStore.BulkCurrentReadingsResult = new VueBulkCurrentReadingsResponse(new[]
        {
            new VueDeviceCurrentReadings(480380, 1712592000, new[]
            {
                new VueChannelReading("1,2,3", "Main", 8450.5),
            }),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    // ── Daily Readings (Feature 007) ──

    [Fact]
    public async Task DailyReadings_ReturnsOk_WithDate()
    {
        // Arrange
        _factory.MockVueStore.DailyReadingsResult = new VueBulkDailyReadingsResponse("2026-04-09", new[]
        {
            new VueDeviceDailyReadings(480380, new[]
            {
                new VueDailyChannelReading("4", "Kitchen", 3.2),
            }),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=2026-04-09");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("2026-04-09", doc.RootElement.GetProperty("date").GetString());
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNoDate()
    {
        var response = await _client.GetAsync("/api/v1/vue/readings/daily");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenInvalidDate()
    {
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=invalid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
