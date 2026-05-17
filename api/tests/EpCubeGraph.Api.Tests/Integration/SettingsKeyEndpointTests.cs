using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsKeyEndpointTests
{
    // ── GET /api/v1/settings ──

    [Fact]
    public async Task GetSettings_ReturnsAllSettings()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockSettingsStore.SetSettings(new List<SettingEntry>
        {
            new("epcube_poll_interval_seconds", "30", DateTimeOffset.UtcNow),
            new("vue_poll_interval_seconds", "1", DateTimeOffset.UtcNow),
        });
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/settings");

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
        using var factory = new MockableTestFactory();
        factory.MockSettingsStore.SetSettings(new List<SettingEntry>());
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/settings");

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
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("60");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

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
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("0");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_ValueAboveMaximum_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("7200");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_NonNumericValue_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("not_a_number");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/epcube_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_UnknownKey_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("42");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/unknown_key", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Unknown setting key", body.Error);
    }

    // ── PUT /api/v1/settings/discovery_interval_seconds ──

    [Fact]
    public async Task UpdateDiscoveryInterval_ValidValue_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("1800");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<SettingEntry>();
        Assert.NotNull(body);
        Assert.Equal("discovery_interval_seconds", body.Key);
        Assert.Equal("1800", body.Value);
    }

    [Fact]
    public async Task UpdateDiscoveryInterval_BelowMinimum_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("30");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateDiscoveryInterval_AboveMaximum_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("100000");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateDiscoveryInterval_NonInteger_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("not_a_number");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateDiscoveryInterval_MinBoundary_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("60");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task UpdateDiscoveryInterval_MaxBoundary_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("86400");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/discovery_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── PUT /api/v1/settings/vue_daily_poll_interval_seconds ──

    [Fact]
    public async Task UpdateSetting_VueDailyPollInterval_ValidValue_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("300");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

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
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("0");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDailyPollInterval_AboveMax_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("7200");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_daily_poll_interval_seconds", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── PUT /api/v1/settings/vue_device_mapping ──

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_ValidJson_Returns200()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube3483\":{\"gid\":480380,\"alias\":\"Main Panel\"}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

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
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("{}");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_InvalidJson_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("not valid json");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("Invalid JSON", body.Error);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_InvalidStructure_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var request = new SettingUpdateRequest("{\"epcube1\": \"not-an-object\"}");

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("object with", body.Error);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_DuplicateGids_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":480380,\"alias\":\"A\"},\"epcube2\":{\"gid\":480380,\"alias\":\"B\"}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

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
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":480380}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_OldArrayFormat_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":[{\"gid\":480380,\"alias\":\"Main Panel\"}]}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        Assert.NotNull(body);
        Assert.Contains("legacy", body.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_NullAlias_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":480380,\"alias\":null}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_NumericAlias_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":480380,\"alias\":42}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_ZeroGid_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":0,\"alias\":\"Panel\"}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_NegativeGid_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":-1,\"alias\":\"Panel\"}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateSetting_VueDeviceMapping_EmptyAlias_Returns400()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();
        var json = "{\"epcube1\":{\"gid\":480380,\"alias\":\"\"}}";
        var request = new SettingUpdateRequest(json);

        // Act
        var response = await client.PutAsJsonAsync("/api/v1/settings/vue_device_mapping", request);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
