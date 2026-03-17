using System.Text.Json;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

/// <summary>
/// Tests for model record construction and JSON serialization.
/// Covers: DeviceListResponse, DeviceMetricsResponse, ErrorResponse.
/// (DeviceInfo and HealthResponse are already covered by other tests.)
/// </summary>
public class ModelSerializationTests
{
    [Fact]
    public void DeviceListResponse_Serialization_UsesJsonPropertyNames()
    {
        var devices = new List<DeviceInfo>
        {
            new("battery", "storage_battery", "10.0.0.1")
        };
        var response = new DeviceListResponse(devices);

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.True(doc.RootElement.TryGetProperty("devices", out var arr));
        Assert.Equal(1, arr.GetArrayLength());
        Assert.Equal("battery", arr[0].GetProperty("device").GetString());
    }

    [Fact]
    public void DeviceListResponse_EmptyList_Serializes()
    {
        var response = new DeviceListResponse(new List<DeviceInfo>());
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(0, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    [Fact]
    public void DeviceMetricsResponse_Serialization_UsesJsonPropertyNames()
    {
        var response = new DeviceMetricsResponse("epcube_battery", new[] { "soc", "power" });

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("epcube_battery", doc.RootElement.GetProperty("device").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("metrics").GetArrayLength());
    }

    [Fact]
    public void ErrorResponse_Serialization_UsesJsonPropertyNames()
    {
        var response = new ErrorResponse("error", "bad_data", "Something went wrong");

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("error", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("bad_data", doc.RootElement.GetProperty("errorType").GetString());
        Assert.Equal("Something went wrong", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public void ErrorResponse_Deserialization_RoundTrips()
    {
        var original = new ErrorResponse("error", "execution", "timeout");
        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<ErrorResponse>(json);

        Assert.Equal(original, deserialized);
    }

    [Fact]
    public void DeviceMetricsResponse_Deserialization_RoundTrips()
    {
        var original = new DeviceMetricsResponse("dev1", new[] { "m1", "m2" });
        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<DeviceMetricsResponse>(json);

        Assert.NotNull(deserialized);
        Assert.Equal("dev1", deserialized.Device);
        Assert.Equal(2, deserialized.Metrics.Count);
    }

    [Fact]
    public void DeviceListResponse_Deserialization_RoundTrips()
    {
        var original = new DeviceListResponse(new List<DeviceInfo>
        {
            new("d1", "cls", "10.0.0.1", Online: true)
        });
        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<DeviceListResponse>(json);

        Assert.NotNull(deserialized);
        Assert.Single(deserialized.Devices);
        Assert.True(deserialized.Devices[0].Online);
    }

    // ── Edge Cases: HealthResponse ──

    [Fact]
    public void HealthResponse_Serialization_UsesJsonPropertyNames()
    {
        var response = new HealthResponse("healthy", "reachable");

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("healthy", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("reachable", doc.RootElement.GetProperty("victoriametrics").GetString());
    }

    [Fact]
    public void HealthResponse_Deserialization_RoundTrips()
    {
        var original = new HealthResponse("unhealthy", "unreachable");
        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<HealthResponse>(json);

        Assert.Equal(original, deserialized);
    }

    // ── Edge Cases: Record Equality ──

    [Fact]
    public void DeviceInfo_RecordEquality_EqualInstances()
    {
        var a = new DeviceInfo("dev1", "cls", "mfr", "pc", "uid", true);
        var b = new DeviceInfo("dev1", "cls", "mfr", "pc", "uid", true);

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    [Fact]
    public void DeviceInfo_RecordEquality_DifferentInstances()
    {
        var a = new DeviceInfo("dev1", "cls");
        var b = new DeviceInfo("dev2", "cls");

        Assert.NotEqual(a, b);
        Assert.True(a != b);
    }

    [Fact]
    public void ErrorResponse_RecordEquality()
    {
        var a = new ErrorResponse("error", "bad_data", "msg");
        var b = new ErrorResponse("error", "bad_data", "msg");

        Assert.Equal(a, b);
    }

    [Fact]
    public void HealthResponse_RecordEquality()
    {
        var a = new HealthResponse("healthy", "reachable");
        var b = new HealthResponse("healthy", "reachable");

        Assert.Equal(a, b);
    }

    // ── Edge Cases: Empty / Special Values ──

    [Fact]
    public void ErrorResponse_WithEmptyStrings_Serializes()
    {
        var response = new ErrorResponse("", "", "");
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("", doc.RootElement.GetProperty("errorType").GetString());
        Assert.Equal("", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public void DeviceMetricsResponse_WithEmptyMetrics_Serializes()
    {
        var response = new DeviceMetricsResponse("device1", Array.Empty<string>());
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(0, doc.RootElement.GetProperty("metrics").GetArrayLength());
    }

    [Fact]
    public void DeviceListResponse_WithMultipleDevices_PreservesOrder()
    {
        var devices = new List<DeviceInfo>
        {
            new("battery", "storage_battery", Online: true),
            new("solar", "home_solar"),
            new("meter", "smart_meter", Manufacturer: "TestMfr")
        };
        var response = new DeviceListResponse(devices);
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        var arr = doc.RootElement.GetProperty("devices");
        Assert.Equal(3, arr.GetArrayLength());
        Assert.Equal("battery", arr[0].GetProperty("device").GetString());
        Assert.Equal("solar", arr[1].GetProperty("device").GetString());
        Assert.Equal("meter", arr[2].GetProperty("device").GetString());
    }

    [Fact]
    public void DeviceInfo_WithSpecialCharactersInFields_Serializes()
    {
        var device = new DeviceInfo(
            "test_device",
            "cls",
            Manufacturer: "Company & Co <Ltd>",
            ProductCode: "Model \"X\"");

        var json = JsonSerializer.Serialize(device);
        var deserialized = JsonSerializer.Deserialize<DeviceInfo>(json);

        Assert.NotNull(deserialized);
        Assert.Equal("Company & Co <Ltd>", deserialized.Manufacturer);
        Assert.Equal("Model \"X\"", deserialized.ProductCode);
    }

    [Fact]
    public void DeviceInfo_GetHashCode_ConsistentForEqualRecords()
    {
        var a = new DeviceInfo("dev1", "cls", Online: true);
        var b = new DeviceInfo("dev1", "cls", Online: true);

        Assert.Equal(a.GetHashCode(), b.GetHashCode());
    }

    [Fact]
    public void DeviceInfo_ToString_ContainsValues()
    {
        var device = new DeviceInfo("dev1", "cls");
        var str = device.ToString();

        Assert.Contains("dev1", str);
        Assert.Contains("cls", str);
    }
}
