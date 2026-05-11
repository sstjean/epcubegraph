using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Auth integration tests — verifies Entra ID enforcement on all endpoints.
/// Uses TestWebApplicationFactory (real auth, no mock bypass).
/// </summary>
public class ApiIntegrationTests
{
    [Fact]
    public async Task Health_ReturnsOk_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/health");

        // Assert — Health endpoint allows anonymous — should NOT return 401
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsUnauthorized_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsUnauthorized_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/range?metric=battery_soc&start=0&end=1&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsUnauthorized_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsUnauthorized_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsUnauthorized_WithoutAuth()
    {
        // Arrange
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/grid");

        // Assert
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
