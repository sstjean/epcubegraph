using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsHierarchyEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public SettingsHierarchyEndpointTests(MockableTestFactory factory)
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

    // ── GET /api/v1/settings/hierarchy ──

    [Fact]
    public async Task GetHierarchy_ReturnsEntries()
    {
        // Arrange
        _factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>
        {
            new(1, 100, 200),
            new(2, 100, 300),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/settings/hierarchy");

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
        _factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>());

        // Act
        var response = await _client.GetAsync("/api/v1/settings/hierarchy");

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
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 300),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PanelHierarchyResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Entries.Count);
    }

    [Fact]
    public async Task UpdateHierarchy_CircularReference_Returns400()
    {
        // Arrange — A → B → A
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 100),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("circular", body.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UpdateHierarchy_SelfReference_Returns400()
    {
        // Arrange — A → A
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 100),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateHierarchy_EmptyEntries_ClearsAll()
    {
        // Arrange — set up existing, then clear
        _factory.MockSettingsStore.SetHierarchy(new List<PanelHierarchyEntry>
        {
            new(1, 100, 200),
        });
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>());

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

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
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 200),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Duplicate edge", body.Error);
    }

    [Fact]
    public async Task UpdateHierarchy_TransitiveCycle_Returns400()
    {
        // Arrange — A → B → C → D → A (4-node cycle)
        var request = new PanelHierarchyRequest(new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
            new(300, 400),
            new(400, 100),
        });

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/hierarchy", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("circular", body.Error, StringComparison.OrdinalIgnoreCase);
    }
}
