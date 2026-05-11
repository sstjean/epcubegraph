using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsHierarchyEndpointTests
{
    // ── GET /api/v1/settings/hierarchy ──

    [Fact]
    public async Task GetHierarchy_ReturnsEntries()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>
        {
            new(1, 100, 200),
            new(2, 100, 300),
        });
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/settings/hierarchy");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PanelHierarchyResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Entries.Count);
    }

    [Fact]
    public async Task GetHierarchy_ReturnsEmptyWhenNoEntries()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>());
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/settings/hierarchy");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PanelHierarchyResponse>();
        Assert.NotNull(body);
        Assert.Empty(body.Entries);
    }

    // ── PUT /api/v1/settings/hierarchy ──

    [Fact]
    public async Task UpdateHierarchy_ValidEntries_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 300),
        });

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PanelHierarchyResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Entries.Count);
    }

    [Fact]
    public async Task UpdateHierarchy_CircularReference_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 100),
        });

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("circular", body.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UpdateHierarchy_SelfReference_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 100),
        });

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateHierarchy_EmptyEntries_ClearsAll()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>
        {
            new(1, 100, 200),
        });
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>());

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PanelHierarchyResponse>();
        Assert.NotNull(body);
        Assert.Empty(body.Entries);
    }

    [Fact]
    public async Task UpdateHierarchy_DuplicateEdges_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 200),
        });

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Duplicate edge", body.Error);
    }

    [Fact]
    public async Task UpdateHierarchy_TransitiveCycle_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
            new(300, 400),
            new(400, 100),
        });

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("circular", body.Error, StringComparison.OrdinalIgnoreCase);
    }
}
