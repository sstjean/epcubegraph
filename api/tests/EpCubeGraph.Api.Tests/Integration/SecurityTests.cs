using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Security tests:
/// - All telemetry endpoints reject unauthenticated requests
/// - /health exposes no telemetry data
/// </summary>
public class SecurityTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly HttpClient _client;

    public SecurityTests(TestWebApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Theory]
    [InlineData("/api/v1/readings/current?metric=battery_soc")]
    [InlineData("/api/v1/readings/range?metric=battery_soc&start=0&end=1&step=60")]
    [InlineData("/api/v1/devices")]
    [InlineData("/api/v1/devices/battery/metrics")]
    [InlineData("/api/v1/grid")]
    public async Task TelemetryEndpoints_RejectUnauthenticated(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Health_DoesNotExposeTelemetryData()
    {
        var response = await _client.GetAsync("/api/v1/health");
        var content = await response.Content.ReadAsStringAsync();

        // Health endpoint should only contain status info, not telemetry values
        Assert.DoesNotContain("epcube_", content);
        Assert.DoesNotContain("battery", content.ToLowerInvariant());
        Assert.DoesNotContain("solar", content.ToLowerInvariant());
    }
}
