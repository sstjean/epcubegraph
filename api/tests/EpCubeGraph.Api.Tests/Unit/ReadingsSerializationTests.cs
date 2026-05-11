using System.Text.Json;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

public class ReadingsSerializationTests
{
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

    [Fact]
    public void TimeSeriesPoint_Serialization_UsesJsonPropertyNames()
    {
        var point = new TimeSeriesPoint(1709827200, 42.5);

        var json = JsonSerializer.Serialize(point);
        var doc = JsonDocument.Parse(json);

        Assert.Equal(1709827200, doc.RootElement.GetProperty("timestamp").GetInt64());
        Assert.Equal(42.5, doc.RootElement.GetProperty("value").GetDouble());
    }

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
}
