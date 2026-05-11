using System.Text.Json;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

public class ErrorHealthSerializationTests
{
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
}
