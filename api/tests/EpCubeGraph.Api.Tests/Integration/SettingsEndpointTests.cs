using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public SettingsEndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    // ── GET /api/v1/settings ──

    [Fact]
    public async Task GetSettings_ReturnsAllSettings()
    {
        // Arrange
        _factory.MockSettingsStore.SetSettings(new List<SettingEntry>
        {
            new("epcube_poll_interval_seconds", "30", DateTimeOffset.UtcNow),
            new("vue_poll_interval_seconds", "1", DateTimeOffset.UtcNow),
        });

        // Act
        var response = await _client.GetAsync("/api/v1/settings");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingsResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Settings.Count);
    }

    [Fact]
    public async Task GetSettings_ReturnsEmptyWhenNoSettings()
    {
        // Arrange
        _factory.MockSettingsStore.SetSettings(new List<SettingEntry>());

        // Act
        var response = await _client.GetAsync("/api/v1/settings");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingsResponse>();
        Assert.NotNull(body);
        Assert.Empty(body.Settings);
    }

    // ── PUT /api/v1/settings/{key} ──

    [Fact]
    public async Task UpdateSetting_ValidValue_Returns200()
    {
        // Arrange
        var request = new SettingUpdateRequest("60");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingEntry>();
        Assert.NotNull(body);
        Assert.Equal("epcube_poll_interval_seconds", body.Key);
        Assert.Equal("60", body.Value);
    }

    [Fact]
    public async Task UpdateSetting_ValueBelowMinimum_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("0");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_ValueAboveMaximum_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("7200");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_NonNumericValue_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("not_a_number");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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
}
