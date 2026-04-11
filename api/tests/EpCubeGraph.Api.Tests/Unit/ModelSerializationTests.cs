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
        Assert.Equal("reachable", doc.RootElement.GetProperty("datastore").GetString());
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
        var device = new DeviceInfo("dev1", "cls");

        var str = device.ToString();

        Assert.Contains("dev1", str);
        Assert.Contains("cls", str);
    }

    // ── Reading ──

    [Fact]
    public void Reading_Serialization_UsesJsonPropertyNames()
    {
        var reading = new Reading("epcube_battery", 1709827200, 42.5);

        var json = JsonSerializer.Serialize(reading);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("epcube_battery", doc.RootElement.GetProperty("device_id").GetString());
        Assert.Equal(1709827200, doc.RootElement.GetProperty("timestamp").GetInt64());
        Assert.Equal(42.5, doc.RootElement.GetProperty("value").GetDouble());
    }

    [Fact]
    public void Reading_Deserialization_RoundTrips()
    {
        var original = new Reading("dev1", 1000, 99.9);
        var json = JsonSerializer.Serialize(original);

        var deserialized = JsonSerializer.Deserialize<Reading>(json);

        Assert.Equal(original, deserialized);
    }

    // ── CurrentReadingsResponse ──

    [Fact]
    public void CurrentReadingsResponse_Serialization_UsesJsonPropertyNames()
    {
        var response = new CurrentReadingsResponse("battery_soc", new[]
        {
            new Reading("battery", 1000, 85.0),
            new Reading("battery2", 1000, 90.0)
        });

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    [Fact]
    public void CurrentReadingsResponse_EmptyReadings_Serializes()
    {
        var response = new CurrentReadingsResponse("test_metric", Array.Empty<Reading>());

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(0, doc.RootElement.GetProperty("readings").GetArrayLength());
    }

    // ── TimeSeriesPoint ──

    [Fact]
    public void TimeSeriesPoint_Serialization_UsesJsonPropertyNames()
    {
        var point = new TimeSeriesPoint(1709827200, 42.5);

        var json = JsonSerializer.Serialize(point);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(1709827200, doc.RootElement.GetProperty("timestamp").GetInt64());
        Assert.Equal(42.5, doc.RootElement.GetProperty("value").GetDouble());
    }

    // ── TimeSeries ──

    [Fact]
    public void TimeSeries_Serialization_UsesJsonPropertyNames()
    {
        var series = new TimeSeries("epcube_battery", new[]
        {
            new TimeSeriesPoint(1000, 10.0),
            new TimeSeriesPoint(1060, 11.0)
        });

        var json = JsonSerializer.Serialize(series);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("epcube_battery", doc.RootElement.GetProperty("device_id").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("values").GetArrayLength());
    }

    // ── RangeReadingsResponse ──

    [Fact]
    public void RangeReadingsResponse_Serialization_UsesJsonPropertyNames()
    {
        var response = new RangeReadingsResponse("battery_soc", new[]
        {
            new TimeSeries("battery", new[] { new TimeSeriesPoint(1000, 85.0) })
        });

        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        Assert.Equal("battery_soc", doc.RootElement.GetProperty("metric").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("series").GetArrayLength());
    }

    [Fact]
    public void RangeReadingsResponse_Deserialization_RoundTrips()
    {
        var original = new RangeReadingsResponse("m1", new[]
        {
            new TimeSeries("d1", new[] { new TimeSeriesPoint(1000, 1.0), new TimeSeriesPoint(1060, 2.0) }),
            new TimeSeries("d2", new[] { new TimeSeriesPoint(1000, 3.0) })
        });
        var json = JsonSerializer.Serialize(original);

        var deserialized = JsonSerializer.Deserialize<RangeReadingsResponse>(json);

        Assert.NotNull(deserialized);
        Assert.Equal("m1", deserialized.Metric);
        Assert.Equal(2, deserialized.Series.Count);
    }

    // ── Vue Bulk Models (Feature 007 — T002) ──

    [Fact]
    public void VueBulkCurrentReadingsResponse_Serialization_UsesJsonPropertyNames()
    {
        // Arrange
        var channels = new List<VueChannelReading>
        {
            new("1,2,3", "Main", 8450.5),
            new("1", "Kitchen", 1200.0),
        };
        var devices = new List<VueDeviceCurrentReadings>
        {
            new(480380, 1712592000, channels)
        };
        var response = new VueBulkCurrentReadingsResponse(devices);

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.True(doc.RootElement.TryGetProperty("devices", out var arr));
        Assert.Equal(1, arr.GetArrayLength());
        Assert.Equal(480380, arr[0].GetProperty("device_gid").GetInt64());
        Assert.Equal(2, arr[0].GetProperty("channels").GetArrayLength());
    }

    [Fact]
    public void VueBulkCurrentReadingsResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new VueBulkCurrentReadingsResponse(new List<VueDeviceCurrentReadings>
        {
            new(12345, 1712592000, new List<VueChannelReading>
            {
                new("1", "Kitchen", 850.5)
            })
        });
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<VueBulkCurrentReadingsResponse>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Single(deserialized.Devices);
        Assert.Equal(12345, deserialized.Devices[0].DeviceGid);
    }

    [Fact]
    public void VueBulkDailyReadingsResponse_Serialization_UsesJsonPropertyNames()
    {
        // Arrange
        var channels = new List<VueDailyChannelReading>
        {
            new("1,2,3", "Main", 42.5),
            new("Balance", "Unmonitored loads", 8.1),
        };
        var devices = new List<VueDeviceDailyReadings>
        {
            new(480380, channels)
        };
        var response = new VueBulkDailyReadingsResponse("2026-04-09", devices);

        // Act
        var json = JsonSerializer.Serialize(response);
        var doc = JsonDocument.Parse(json);

        // Assert
        Assert.Equal("2026-04-09", doc.RootElement.GetProperty("date").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("devices").GetArrayLength());
        var dev = doc.RootElement.GetProperty("devices")[0];
        Assert.Equal(480380, dev.GetProperty("device_gid").GetInt64());
        Assert.Equal(2, dev.GetProperty("channels").GetArrayLength());
        Assert.Equal(42.5, dev.GetProperty("channels")[0].GetProperty("kwh").GetDouble());
    }

    [Fact]
    public void VueBulkDailyReadingsResponse_Deserialization_RoundTrips()
    {
        // Arrange
        var original = new VueBulkDailyReadingsResponse("2026-04-09", new List<VueDeviceDailyReadings>
        {
            new(480380, new List<VueDailyChannelReading>
            {
                new("1", "Kitchen", 3.2)
            })
        });
        var json = JsonSerializer.Serialize(original);

        // Act
        var deserialized = JsonSerializer.Deserialize<VueBulkDailyReadingsResponse>(json);

        // Assert
        Assert.NotNull(deserialized);
        Assert.Equal("2026-04-09", deserialized.Date);
        Assert.Single(deserialized.Devices);
    }
}
