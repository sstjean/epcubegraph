using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class PendingReplacementEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public PendingReplacementEndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    [Fact]
    public async Task GetPendingReplacements_ReturnsListFromStore()
    {
        // Arrange
        var detected = new DateTimeOffset(2026, 5, 8, 14, 30, 0, TimeSpan.Zero);
        _factory.MockStore.PendingReplacementsResult = new List<PendingReplacement>
        {
            new(1, "100", "200", detected),
            new(2, "300", "400", detected),
        };

        // Act
        var response = await _client.GetAsync("/api/v1/devices/pending-replacements");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<List<PendingReplacement>>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Count);
        Assert.Equal("100", body[0].OldDeviceId);
        Assert.Equal("200", body[0].NewDeviceId);
    }

    [Fact]
    public async Task GetPendingReplacements_ReturnsEmptyListWhenNone()
    {
        // Arrange — default empty result

        // Act
        var response = await _client.GetAsync("/api/v1/devices/pending-replacements");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<List<PendingReplacement>>();
        Assert.NotNull(body);
        Assert.Empty(body);
    }

    [Fact]
    public async Task GetPendingReplacements_Returns422OnStoreError()
    {
        // Arrange
        _factory.MockStore.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/pending-replacements");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DismissPendingReplacement_ReturnsOkWhenFound()
    {
        // Arrange
        _factory.MockStore.DismissResult = new DismissResponse(true, "100", "200");

        // Act
        var response = await _client.PostAsync("/api/v1/devices/pending-replacements/42/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DismissResponse>();
        Assert.NotNull(body);
        Assert.True(body.Dismissed);
        Assert.Equal("100", body.OldDeviceId);
        Assert.Equal(42, _factory.MockStore.LastDismissedId);
    }

    [Fact]
    public async Task DismissPendingReplacement_Returns404WhenNotFound()
    {
        // Arrange — store returns null (record not found)
        _factory.MockStore.DismissResult = null;

        // Act
        var response = await _client.PostAsync("/api/v1/devices/pending-replacements/999/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DismissPendingReplacement_Returns422OnStoreError()
    {
        // Arrange
        _factory.MockStore.ShouldThrow = true;

        // Act
        var response = await _client.PostAsync("/api/v1/devices/pending-replacements/1/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
