using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class DeviceStatusFilterTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public DeviceStatusFilterTests(MockableTestFactory factory)
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

    [Fact]
    public async Task GetDevices_DefaultReturnsActiveOnly()
    {
        // Arrange
        _factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: true, Alias: "EP Cube"),
            new("epcube222_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

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
        _factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };

        // Act
        var response = await _client.GetAsync("/api/v1/devices?status=removed");

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
        _factory.MockStore.DevicesResult = new List<DeviceInfo>
        {
            new("epcube111_battery", "storage_battery", Online: true, Alias: "EP Cube"),
            new("epcube222_battery", "storage_battery", Online: false, Alias: "Old EP Cube"),
        };

        // Act
        var response = await _client.GetAsync("/api/v1/devices?status=all");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeviceListResponse>();
        Assert.NotNull(body);
        Assert.Equal(2, body.Devices.Count);
    }
}
