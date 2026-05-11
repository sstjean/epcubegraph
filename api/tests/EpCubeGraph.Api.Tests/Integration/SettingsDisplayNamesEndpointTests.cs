using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsDisplayNamesEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public SettingsDisplayNamesEndpointTests(MockableTestFactory factory)
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

    // ── GET /api/v1/settings/display-names ──

    [Fact]
    public async Task GetDisplayNames_ReturnsOverrides()
    {
        // Arrange
        _factory.MockSettingsStore.SetDisplayNames(new List<DisplayNameOverride>
        {
            new(1, 1000, "1", "Kitchen"),
            new(2, 1000, null, "Main Panel"),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/settings/display-names");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DisplayNamesResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Overrides.Count);
    }

    // ── PUT /api/v1/settings/display-names/{deviceGid} ──

    [Fact]
    public async Task UpdateDisplayNames_Returns200()
    {
        // Arrange
        var request = new DisplayNameUpdateRequest(new List<DisplayNameInputEntry>
        {
            new("1", "Kitchen Fridge"),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/display-names/1000", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DisplayNamesResponse>();
        Assert.NotNull(body);
        Assert.Single(body.Overrides);
    }

    [Fact]
    public async Task UpdateDisplayNames_DuplicateChannels_Returns400()
    {
        // Arrange
        var request = new DisplayNameUpdateRequest(new List<DisplayNameInputEntry>
        {
            new("1", "Kitchen"),
            new("1", "Kitchen Fridge"),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/display-names/1000", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Duplicate channel", body.Error);
    }

    // ── DELETE /api/v1/settings/display-names/{deviceGid}/{channelNumber} ──

    [Fact]
    public async Task DeleteDisplayName_Returns204WhenFound()
    {
        // Arrange
        _factory.MockSettingsStore.SetDisplayNames(new List<DisplayNameOverride>
        {
            new(1, 2000, "3", "Garage"),
        });

        // Act
        var response = await _client.DeleteAsync("/api/v1/settings/display-names/2000/3");

        // Assert
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task DeleteDisplayName_Returns404WhenNotFound()
    {
        // Arrange
        _factory.MockSettingsStore.SetDisplayNames(new List<DisplayNameOverride>());

        // Act
        var response = await _client.DeleteAsync("/api/v1/settings/display-names/9999/99");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
