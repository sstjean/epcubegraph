using System.Net;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class DevicesEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public DevicesEndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockStore.Reset();
        _factory.MockSettingsStore.Reset();
        _factory.MockVueStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

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
}
