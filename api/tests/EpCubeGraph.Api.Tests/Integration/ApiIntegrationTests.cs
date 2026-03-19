using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

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
        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        // Health endpoint allows anonymous — may return 200 or 503
        // depending on VictoriaMetrics availability, but should NOT return 401
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query_range?query=up&start=0&end=1&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/grid");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Labels_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/labels");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/device/values");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsUnauthorized_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/series?match=up");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Metrics_ReturnsOk_WithoutAuth()
    {
        // Act
        var response = await _client.GetAsync("/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        Assert.Contains("process_", content); // prometheus-net exposes process metrics
    }
}
