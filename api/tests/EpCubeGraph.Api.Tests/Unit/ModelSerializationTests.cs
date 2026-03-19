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
        // Arrange
        var devices = new List<DeviceInfo>
        {
            new("battery", "storage_battery", Manufacturer: "EpCube")
        };
        var response = new DeviceListResponse(devices);

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.True(doc.RootElement.TryGetProperty("devices", out var arr));
        Assert.Equal(1, arr.GetArrayLength());
        Assert.Equal("battery", arr[0].GetProperty("device").GetString());
    }

    [Fact]
    public void DeviceListResponse_EmptyList_Serializes()
    {
        // Arrange
        var response = new DeviceListResponse(new List<DeviceInfo>());

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal(0, doc.RootElement.GetProperty("devices").GetArrayLength());
    }

    [Fact]
    public void DeviceMetricsResponse_Serialization_UsesJsonPropertyNames()
    {
        // Arrange
        var response = new DeviceMetricsResponse("epcube_battery", new[] { "soc", "power" });

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal("epcube_battery", doc.RootElement.GetProperty("device").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("metrics").GetArrayLength());
    }

    [Fact]
    public void ErrorResponse_Serialization_UsesJsonPropertyNames()
    {
        // Arrange
        var response = new ErrorResponse("error", "bad_data", "Something went wrong");

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal("error", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("bad_data", doc.RootElement.GetProperty("errorType").GetString());
        Assert.Equal("Something went wrong", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public void ErrorResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new ErrorResponse("error", "execution", "timeout");
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<ErrorResponse>(json);

        // Assert
        Assert.Equal(original, deserialized);
    }

    [Fact]
    public void DeviceMetricsResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new DeviceMetricsResponse("dev1", new[] { "m1", "m2" });
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<DeviceMetricsResponse>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Equal("dev1", deserialized.Device);
        Assert.Equal(2, deserialized.Metrics.Count);
    }

    [Fact]
    public void DeviceListResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new DeviceListResponse(new List<DeviceInfo>
        {
            new("d1", "cls", Manufacturer: "EpCube", Online: true)
        });
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<DeviceListResponse>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Single(deserialized.Devices);
        Assert.True(deserialized.Devices[0].Online);
    }

    // ── Edge Cases: HealthResponse ──

    [Fact]
    public void HealthResponse_Serialization_UsesJsonPropertyNames()
    {
        // Arrange
        var response = new HealthResponse("healthy", "reachable");

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal("healthy", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("reachable", doc.RootElement.GetProperty("victoriametrics").GetString());
    }

    [Fact]
    public void HealthResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new HealthResponse("unhealthy", "unreachable");
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<HealthResponse>(json);

        // Assert
        Assert.Equal(original, deserialized);
    }

    // ── Edge Cases: Record Equality ──

    [Fact]
    public void DeviceInfo_RecordEquality_EqualInstances()
    {
        // Arrange
        var a = new DeviceInfo("dev1", "cls", "mfr", "pc", "uid", true);
        var b = new DeviceInfo("dev1", "cls", "mfr", "pc", "uid", true);

        // Assert
        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    [Fact]
    public void DeviceInfo_RecordEquality_DifferentInstances()
    {
        // Arrange
        var a = new DeviceInfo("dev1", "cls");
        var b = new DeviceInfo("dev2", "cls");

        // Assert
        Assert.NotEqual(a, b);
        Assert.True(a != b);
    }

    [Fact]
    public void ErrorResponse_RecordEquality()
    {
        // Arrange
        var a = new ErrorResponse("error", "bad_data", "msg");
        var b = new ErrorResponse("error", "bad_data", "msg");

        // Assert
        Assert.Equal(a, b);
    }

    [Fact]
    public void HealthResponse_RecordEquality()
    {
        // Arrange
        var a = new HealthResponse("healthy", "reachable");
        var b = new HealthResponse("healthy", "reachable");

        // Assert
        Assert.Equal(a, b);
    }

    // ── Edge Cases: Empty / Special Values ──

    [Fact]
    public void ErrorResponse_WithEmptyStrings_Serializes()
    {
        // Arrange
        var response = new ErrorResponse("", "", "");

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal("", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("", doc.RootElement.GetProperty("errorType").GetString());
        Assert.Equal("", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public void DeviceMetricsResponse_WithEmptyMetrics_Serializes()
    {
        // Arrange
        var response = new DeviceMetricsResponse("device1", Array.Empty<string>());

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal(0, doc.RootElement.GetProperty("metrics").GetArrayLength());
    }

    [Fact]
    public void DeviceListResponse_WithMultipleDevices_PreservesOrder()
    {
        // Arrange
        var devices = new List<DeviceInfo>
        {
            new("battery", "storage_battery", Online: true),
            new("solar", "home_solar"),
            new("meter", "smart_meter", Manufacturer: "TestMfr")
        };
        var response = new DeviceListResponse(devices);

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        var arr = doc.RootElement.GetProperty("devices");
        Assert.Equal(3, arr.GetArrayLength());
        Assert.Equal("battery", arr[0].GetProperty("device").GetString());
        Assert.Equal("solar", arr[1].GetProperty("device").GetString());
        Assert.Equal("meter", arr[2].GetProperty("device").GetString());
    }

    [Fact]
    public void DeviceInfo_WithSpecialCharactersInFields_Serializes()
    {
        // Arrange
        var device = new DeviceInfo(
            "test_device",
            "cls",
            Manufacturer: "Company & Co <Ltd>",
            ProductCode: "Model \"X\"");

        // Act
        var json = JsonSerializer.Serialize(device);
        var deserialized = JsonSerializer.Deserialize<DeviceInfo>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Equal("Company & Co <Ltd>", deserialized.Manufacturer);
        Assert.Equal("Model \"X\"", deserialized.ProductCode);
    }

    [Fact]
    public void DeviceInfo_GetHashCode_ConsistentForEqualRecords()
    {
        // Arrange
        var a = new DeviceInfo("dev1", "cls", Online: true);
        var b = new DeviceInfo("dev1", "cls", Online: true);

        // Assert
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
    }

    [Fact]
    public void DeviceInfo_ToString_ContainsValues()
    {
        // Arrange
        var device = new DeviceInfo("dev1", "cls");

        // Act
        var str = device.ToString();

        // Assert
        Assert.Contains("dev1", str);
        Assert.Contains("cls", str);
    }
}
