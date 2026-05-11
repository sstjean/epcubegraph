using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class RangeReadingsEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public RangeReadingsEndpointTests(MockableTestFactory factory)
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
    public async Task RangeReadings_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenMetricMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenEndMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStartNotNumeric()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=abc&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepNotPositive()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=-1");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_ReturnsBadRequest_WhenStepZero()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=0");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns400_WhenStartAfterEnd()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=2000&end=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns400_WhenStartEqualsEnd()
    {
        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RangeReadings_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync(
            "/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
