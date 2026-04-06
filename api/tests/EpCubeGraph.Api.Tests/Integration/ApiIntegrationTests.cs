using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Auth integration tests — verifies Entra ID enforcement on all endpoints.
/// Uses TestWebApplicationFactory (real auth, no mock bypass).
/// </summary>
public class ApiIntegrationTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly HttpClient _client;

    public ApiIntegrationTests(TestWebApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Health_ReturnsOk_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/health");

        // Health endpoint allows anonymous — should NOT return 401
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsUnauthorized_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsUnauthorized_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/readings/range?metric=battery_soc&start=0&end=1&step=60");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsUnauthorized_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsUnauthorized_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsUnauthorized_WithoutAuth()
    {
        var response = await _client.GetAsync("/api/v1/grid");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
