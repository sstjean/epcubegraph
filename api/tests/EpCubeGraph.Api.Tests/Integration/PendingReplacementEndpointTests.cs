using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class PendingReplacementEndpointTests
{
    [Fact]
    public async Task GetPendingReplacements_ReturnsListFromStore()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        var detected = new DateTimeOffset(2026, 5, 8, 14, 30, 0, TimeSpan.Zero);
        factory.MockStore.PendingReplacementsResult = new List<PendingReplacement>
        {
            new(1, "100", "200", detected),
            new(2, "300", "400", detected),
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/pending-replacements");

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
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/pending-replacements");

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
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/pending-replacements");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DismissPendingReplacement_ReturnsOkWhenFound()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DismissResult = new DismissResponse(true, "100", "200");
        using var client = factory.CreateClient();

        // Act
        var response = await client.PostAsync("/api/v1/devices/pending-replacements/42/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DismissResponse>();
        Assert.NotNull(body);
        Assert.True(body.Dismissed);
        Assert.Equal("100", body.OldDeviceId);
        Assert.Equal(42, factory.MockStore.LastDismissedId);
    }

    [Fact]
    public async Task DismissPendingReplacement_Returns404WhenNotFound()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DismissResult = null;
        using var client = factory.CreateClient();

        // Act
        var response = await client.PostAsync("/api/v1/devices/pending-replacements/999/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DismissPendingReplacement_Returns422OnStoreError()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.PostAsync("/api/v1/devices/pending-replacements/1/dismiss", content: null);

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
