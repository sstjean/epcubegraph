using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Security review tests (T037):
/// - SC-004: All telemetry endpoints reject unauthenticated requests
/// - /health exposes no telemetry data
/// - /metrics is unauthenticated but exposes only process metrics
/// </summary>
public class SecurityTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly HttpClient _client;

    public SecurityTests(TestWebApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Theory]
    [InlineData("/api/v1/query?query=up")]
    [InlineData("/api/v1/query_range?query=up&start=0&end=1&step=1m")]
    [InlineData("/api/v1/series?match=up")]
    [InlineData("/api/v1/labels")]
    [InlineData("/api/v1/label/device/values")]
    [InlineData("/api/v1/devices")]
    [InlineData("/api/v1/devices/battery/metrics")]
    [InlineData("/api/v1/grid")]
    public async Task SC004_TelemetryEndpoints_RejectUnauthenticated(string url)
    {
        // Act
        var response = await _client.GetAsync(url);

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Health_DoesNotExposeTelemetryData()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/health");
        var content = await response.Content.ReadAsStringAsync();

        // Assert
        // Health endpoint should only contain status info, not telemetry values
        Assert.DoesNotContain("epcube_", content);
        Assert.DoesNotContain("battery", content.ToLowerInvariant());
        Assert.DoesNotContain("solar", content.ToLowerInvariant());
    }

    [Fact]
    public async Task Metrics_ExposesOnlyProcessMetrics_NoTelemetry()
    {
        // Act
        var response = await _client.GetAsync("/metrics");
        var content = await response.Content.ReadAsStringAsync();

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // prometheus-net exposes process metrics, not telemetry data
        Assert.DoesNotContain("epcube_", content);
        Assert.DoesNotContain("epcube_", content);
    }
}
