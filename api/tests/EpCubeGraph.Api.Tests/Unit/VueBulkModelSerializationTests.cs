using System.Text.Json;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

public class VueBulkModelSerializationTests
{
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
