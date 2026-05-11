using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VueEndpointIntegrationTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public VueEndpointIntegrationTests(MockableTestFactory factory)
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
    public async Task BulkCurrentReadings_ReturnsOk()
    {
        // Arrange
        _factory.MockVueStore.BulkCurrentReadingsResult = new VueBulkCurrentReadingsResponse(new[]
        {
            new VueDeviceCurrentReadings(480380, 1712592000, new[]
            {
                new VueChannelReading("1,2,3", "Main", 8450.5),
            }),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/readings/current");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    [Fact]
    public async Task DailyReadings_ReturnsOk_WithDate()
    {
        // Arrange
        _factory.MockVueStore.DailyReadingsResult = new VueBulkDailyReadingsResponse("2026-04-09", new[]
        {
            new VueDeviceDailyReadings(480380, new[]
            {
                new VueDailyChannelReading("4", "Kitchen", 3.2),
            }),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=2026-04-09");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("2026-04-09", doc.RootElement.GetProperty("date").GetString());
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNoDate()
    {
        var response = await _client.GetAsync("/api/v1/vue/readings/daily");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenInvalidDate()
    {
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=invalid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNonLeapYearFeb29()
    {
        // Arrange — 2025 is not a leap year
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=2025-02-29");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenImpossibleDay()
    {
        // Arrange — April has 30 days
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=2026-04-31");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenEmptyDate()
    {
        // Arrange — empty string
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DailyReadings_Returns400_WhenNonIsoFormat()
    {
        // Arrange — US date format
        var response = await _client.GetAsync("/api/v1/vue/readings/daily?date=04/09/2026");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
