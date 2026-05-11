using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class HealthEndpointTests
{
    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("healthy", body);
        Assert.Contains("ok", body);
    }

    [Fact]
    public async Task Health_Returns503_WhenDbUnreachable()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.PingResult = false;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("unhealthy", body);
        Assert.Contains("unreachable", body);
    }
}
