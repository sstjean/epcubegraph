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
        _factory.MockSettingsStore.Reset();
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

    // ── Allowlist / duplicate validation ──

    [Fact]
    public async Task UpdateSetting_UnknownKey_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("42");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/unknown_key", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Unknown setting key", body.Error);
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

    // ── PUT /api/v1/settings/vue_daily_poll_interval_seconds ──

    [Fact]
    public async Task UpdateSetting_VueDailyPollInterval_ValidValue_Returns200()
    {
        // Arrange
        var request = new SettingUpdateRequest("300");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingEntry>();
        Assert.NotNull(body);
        Assert.Equal("vue_daily_poll_interval_seconds", body.Key);
        Assert.Equal("300", body.Value);
    }

    [Fact]
    public async Task UpdateSetting_VueDailyPollInterval_Zero_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("0");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDailyPollInterval_AboveMax_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("7200");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── PUT /api/v1/settings/vue_device_mapping ──

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_ValidJson_Returns200()
    {
        // Arrange
        var mapping = new { epcube3483 = new[] { new { gid = 480380, alias = "Main Panel" } } };
        var request = new SettingUpdateRequest(JsonSerializer.Serialize(mapping));

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingEntry>();
        Assert.NotNull(body);
        Assert.Equal("vue_device_mapping", body.Key);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_EmptyObject_Returns200()
    {
        // Arrange
        var request = new SettingUpdateRequest("{}");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_InvalidJson_Returns400()
    {
        // Arrange
        var request = new SettingUpdateRequest("not valid json");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Invalid JSON", body.Error);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_InvalidStructure_Returns400()
    {
        // Arrange — values must be arrays of objects with gid/alias
        var request = new SettingUpdateRequest("{\"epcube1\": \"not-an-array\"}");

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("arrays of objects", body.Error);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_DuplicateGids_Returns400()
    {
        // Arrange — same GID mapped to two EP Cubes
        var json = "{\"epcube1\":[{\"gid\":480380,\"alias\":\"A\"}],\"epcube2\":[{\"gid\":480380,\"alias\":\"B\"}]}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("480380", body.Error);
        Assert.Contains("multiple", body.Error);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_MissingFields_Returns400()
    {
        // Arrange — missing alias field
        var json = "{\"epcube1\":[{\"gid\":480380}]}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await _client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
