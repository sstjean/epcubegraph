using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class CurrentReadingsEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public CurrentReadingsEndpointTests(MockableTestFactory factory)
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
}
