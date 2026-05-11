using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class RangeReadingsEndpointTests
{
    [Fact]
    public async Task RangeReadings_ReturnsOk_WithValidParams()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenMetricMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?start=1000&end=2000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&end=2000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenEndMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartNotNumeric()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=abc&end=2000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepNotPositive()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=-1");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepZero()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=0");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns400_WhenStartAfterEnd()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=2000&end=1000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns400_WhenStartEqualsEnd()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=1000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns422_WhenStoreFails()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
