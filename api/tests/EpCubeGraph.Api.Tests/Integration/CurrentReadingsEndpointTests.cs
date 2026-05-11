using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class CurrentReadingsEndpointTests
{
    [Fact]
    public async Task CurrentReadings_ReturnsOk_WithValidMetric()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.CurrentReadingsResult = new[]
        {
            new Reading("epcube_battery", 1709827200, 42.5)
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    [Fact]
    public async Task CurrentReadings_ReturnsOk_WithEmptyResult()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'metric' is required", body);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricEmpty()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CurrentReadings_ReturnsBadRequest_WhenMetricInvalid()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=bad-name!");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("invalid characters", body);
    }

    [Fact]
    public async Task CurrentReadings_Returns422_WhenStoreFails()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
