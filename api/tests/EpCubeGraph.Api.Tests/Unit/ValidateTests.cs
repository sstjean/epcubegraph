using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateTests
{
    // ── Required ──

    [Fact]
    public void Required_Null_ReturnsError()
    {
        var result = Validate.Required(null, "query");
        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Empty_ReturnsError()
    {
        var result = Validate.Required("", "query");
        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Whitespace_ReturnsError()
    {
        var result = Validate.Required("   ", "query");
        Assert.NotNull(result);
    }

    [Fact]
    public void Required_ValidValue_ReturnsNull()
    {
        var result = Validate.Required("up", "query");
        Assert.Null(result);
    }

    // ── Timestamp ──

    [Fact]
    public void Timestamp_Null_ReturnsNull()
    {
        // Optional — null is valid
        var result = Validate.Timestamp(null, "start");
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_UnixEpoch_ReturnsNull()
    {
        var result = Validate.Timestamp("1709827200", "start");
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Rfc3339_ReturnsNull()
    {
        var result = Validate.Timestamp("2026-03-07T00:00:00Z", "start");
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Invalid_ReturnsError()
    {
        var result = Validate.Timestamp("not-a-time", "start");
        Assert.NotNull(result);
        Assert.Contains("'start'", result);
        Assert.Contains("RFC3339", result);
    }

    [Fact]
    public void Timestamp_Empty_ReturnsError()
    {
        var result = Validate.Timestamp("", "time");
        Assert.NotNull(result);
    }

    // ── Duration ──

    [Fact]
    public void Duration_Null_ReturnsNull()
    {
        // Optional — null is valid
        var result = Validate.Duration(null, "step");
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidMinutes_ReturnsNull()
    {
        var result = Validate.Duration("1m", "step");
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidHours_ReturnsNull()
    {
        var result = Validate.Duration("1h", "step");
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidSeconds_ReturnsNull()
    {
        var result = Validate.Duration("30s", "step");
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidDays_ReturnsNull()
    {
        var result = Validate.Duration("7d", "step");
        Assert.Null(result);
    }

    [Fact]
    public void Duration_Invalid_ReturnsError()
    {
        var result = Validate.Duration("abc", "step");
        Assert.NotNull(result);
        Assert.Contains("'step'", result);
        Assert.Contains("duration", result);
    }

    [Fact]
    public void Duration_Empty_ReturnsError()
    {
        var result = Validate.Duration("", "step");
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_NoUnit_ReturnsError()
    {
        var result = Validate.Duration("123", "step");
        Assert.NotNull(result);
    }

    // ── SafeName ──

    [Fact]
    public void SafeName_Null_ReturnsError()
    {
        var result = Validate.SafeName(null, "device");
        Assert.NotNull(result);
        Assert.Contains("'device' is required", result);
    }

    [Fact]
    public void SafeName_ValidIdentifier_ReturnsNull()
    {
        var result = Validate.SafeName("epcube_battery", "device");
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_ValidWithUnderscore_ReturnsNull()
    {
        var result = Validate.SafeName("__name__", "label");
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_ValidAlphaNumeric_ReturnsNull()
    {
        var result = Validate.SafeName("device123", "name");
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_InvalidWithDash_ReturnsError()
    {
        var result = Validate.SafeName("some-device", "device");
        Assert.NotNull(result);
        Assert.Contains("invalid characters", result);
    }

    [Fact]
    public void SafeName_InvalidStartsWithNumber_ReturnsError()
    {
        var result = Validate.SafeName("123device", "device");
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_InvalidWithSpaces_ReturnsError()
    {
        var result = Validate.SafeName("ep cube", "device");
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_Empty_ReturnsError()
    {
        var result = Validate.SafeName("", "device");
        Assert.NotNull(result);
    }
}
