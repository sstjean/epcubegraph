using System.Net;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class DevicesEndpointTests
{
    [Fact]
    public async Task Devices_ReturnsOk_WithEmptyList()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceData()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DevicesResult = new[]
        {
            new DeviceInfo("epcube_battery", "storage_battery", "Canadian Solar", "EP Cube 2.0", "ABC123", true, "EP Cube v1 Battery")
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("storage_battery", body);
        Assert.Contains("Canadian Solar", body);
        Assert.Contains("EP Cube v1 Battery", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceMissingOptionalFields()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DevicesResult = new[]
        {
            new DeviceInfo("epcube_solar", "home_solar")
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_solar", body);
    }

    [Fact]
    public async Task Devices_Returns422_WhenStoreFails()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Theory]
    [InlineData("Active")]   // wrong case
    [InlineData("Removed")]
    [InlineData("xyz")]
    [InlineData("inactive")] // not in allowed set
    public async Task Devices_Returns400_OnInvalidStatus(string status)
    {
        // Regression for PR #137 review: previously, unknown/case-mismatched
        // status values silently returned 200 with an empty list. Surface them
        // as 400 bad_data so API consumers can detect the typo.
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/api/v1/devices?status={status}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("bad_data", body);
        Assert.Contains("active, removed, merged, all", body);
    }

    [Theory]
    [InlineData("active")]
    [InlineData("removed")]
    [InlineData("merged")]
    [InlineData("all")]
    public async Task Devices_ReturnsOk_OnValidStatus(string status)
    {
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"/api/v1/devices?status={status}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsOk_WithMetrics()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DeviceMetricsResult = new[]
        {
            "battery_soc", "battery_power"
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("battery_soc", body);
        Assert.Contains("battery_power", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenNoMetrics()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("not_found", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceInvalid()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/bad-device!/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_Returns422_WhenStoreFails()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
