using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class GridEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public GridEndpointTests(MockableTestFactory factory)
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
    public async Task Grid_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("grid_power_watts", doc.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithDefaults()
    {
        var response = await _client.GetAsync("/api/v1/grid");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartInvalid()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=not-a-time&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepInvalid()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartAfterEnd()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=2000&end=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartEqualsEnd()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=1000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_Returns422_WhenStoreFails()
    {
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/grid?start=1000&end=2000&step=60");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
