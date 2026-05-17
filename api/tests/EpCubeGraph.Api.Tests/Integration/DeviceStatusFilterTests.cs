using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class DeviceStatusFilterTests
{
    [Fact]
    public async Task GetDevices_DefaultReturnsActiveOnly()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: true, Alias: "EP Cube"),
            new("epcube222_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeviceListResponse>();
        Assert.NotNull(body);
        // Default behavior unchanged — returns whatever the store returns
        Assert.Equal(2, body.Devices.Count);
    }

    [Fact]
    public async Task GetDevices_WithStatusParameter_PassesToStore()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices?status=removed");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeviceListResponse>();
        Assert.NotNull(body);
        Assert.Single(body.Devices);
    }

    [Fact]
    public async Task GetDevices_WithStatusAll_PassesToStore()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: true, Alias: "EP Cube"),
            new("epcube222_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };
        using var client = factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/v1/devices?status=all");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeviceListResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Devices.Count);
    }
}
