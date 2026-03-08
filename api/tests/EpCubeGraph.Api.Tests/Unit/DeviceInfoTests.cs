using System.Text.Json;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

public class DeviceInfoTests
{
    [Fact]
    public void Serialization_UsesJsonPropertyNames()
    {
        var device = new DeviceInfo(
            Device: "epcube_battery",
            DeviceClass: "storage_battery",
            Ip: "192.168.1.10",
            Manufacturer: "Canadian Solar",
            ProductCode: "EP Cube 2.0",
            Uid: "ABC123",
            Online: true);

        var json = JsonSerializer.Serialize(device);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("epcube_battery", root.GetProperty("device").GetString());
        Assert.Equal("storage_battery", root.GetProperty("class").GetString());
        Assert.Equal("192.168.1.10", root.GetProperty("ip").GetString());
        Assert.Equal("Canadian Solar", root.GetProperty("manufacturer").GetString());
        Assert.Equal("EP Cube 2.0", root.GetProperty("product_code").GetString());
        Assert.Equal("ABC123", root.GetProperty("uid").GetString());
        Assert.True(root.GetProperty("online").GetBoolean());
    }

    [Fact]
    public void Deserialization_FromSnakeCaseJson()
    {
        var json = """
            {
                "device": "epcube_solar",
                "class": "home_solar",
                "ip": "192.168.1.10",
                "online": false
            }
            """;

        var device = JsonSerializer.Deserialize<DeviceInfo>(json);

        Assert.NotNull(device);
        Assert.Equal("epcube_solar", device.Device);
        Assert.Equal("home_solar", device.DeviceClass);
        Assert.Equal("192.168.1.10", device.Ip);
        Assert.False(device.Online);
    }

    [Fact]
    public void OptionalFields_DefaultToNull()
    {
        var device = new DeviceInfo(
            Device: "epcube_battery",
            DeviceClass: "storage_battery",
            Ip: "192.168.1.10");

        Assert.Null(device.Manufacturer);
        Assert.Null(device.ProductCode);
        Assert.Null(device.Uid);
        Assert.False(device.Online);
    }

    [Fact]
    public void DeviceClass_AcceptsStorageBattery()
    {
        var device = new DeviceInfo(Device: "test", DeviceClass: "storage_battery", Ip: "10.0.0.1");
        Assert.Equal("storage_battery", device.DeviceClass);
    }

    [Fact]
    public void DeviceClass_AcceptsHomeSolar()
    {
        var device = new DeviceInfo(Device: "test", DeviceClass: "home_solar", Ip: "10.0.0.1");
        Assert.Equal("home_solar", device.DeviceClass);
    }

    [Fact]
    public void Serialization_OmitsNullOptionalFields()
    {
        var device = new DeviceInfo(
            Device: "epcube_battery",
            DeviceClass: "storage_battery",
            Ip: "192.168.1.10");

        var options = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };
        var json = JsonSerializer.Serialize(device, options);
        var doc = JsonDocument.Parse(json);

        Assert.False(doc.RootElement.TryGetProperty("manufacturer", out _));
        Assert.False(doc.RootElement.TryGetProperty("product_code", out _));
        Assert.False(doc.RootElement.TryGetProperty("uid", out _));
    }
}
