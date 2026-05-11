using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueEndpointIntegrationTests
{
    [Fact]
    public async Task BulkCurrentReadings_ReturnsOk()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockVueStore.BulkCurrentReadingsResult = new VueBulkCurrentReadingsResponse(new[]
        {
            new VueDeviceCurrentReadings(480380, 1712592000, new[]
            {
                new VueChannelReading("1,2,3", "Main", 8450.5),
            }),
        });
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    [Fact]
    public async Task DailyReadings_ReturnsOk_WithDate()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockVueStore.DailyReadingsResult = new VueBulkDailyReadingsResponse("2026-04-09", new[]
        {
            new VueDeviceDailyReadings(480380, new[]
            {
                new VueDailyChannelReading("4", "Kitchen", 3.2),
            }),
        });
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=2026-04-09");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("2026-04-09", doc.RootElement.GetProperty("date").GetString());
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNoDate()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenInvalidDate()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=invalid");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNonLeapYearFeb29()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=2025-02-29");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenImpossibleDay()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=2026-04-31");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenEmptyDate()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNonIsoFormat()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/vue/readings/daily?date=04/09/2026");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
