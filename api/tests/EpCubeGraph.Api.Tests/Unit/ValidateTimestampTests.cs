using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateTimestampTests
{
    [Fact]
    public void Timestamp_Null_ReturnsNull()
    {
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
    public void Timestamp_NegativeEpoch_ReturnsNull()
    {
        var result = Validate.Timestamp("-1", "start");

        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Zero_ReturnsNull()
    {
        var result = Validate.Timestamp("0", "start");

        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_VeryLargeEpoch_ReturnsNull()
    {
        var result = Validate.Timestamp("99999999999", "start");

        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Rfc3339_ReturnsError()
    {
        // RFC3339 is no longer accepted — only Unix epoch integers
        var result = Validate.Timestamp("2026-03-07T00:00:00Z", "start");

        Assert.NotNull(result);
        Assert.Contains("Unix epoch", result);
    }

    [Fact]
    public void Timestamp_DateOnly_ReturnsError()
    {
        var result = Validate.Timestamp("2026-03-07", "start");

        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_Invalid_ReturnsError()
    {
        var result = Validate.Timestamp("not-a-time", "start");

        Assert.NotNull(result);
        Assert.Contains("'start'", result);
    }

    [Fact]
    public void Timestamp_Empty_ReturnsError()
    {
        var result = Validate.Timestamp("", "time");

        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_WhitespaceOnly_ReturnsError()
    {
        var result = Validate.Timestamp("   ", "start");

        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_FloatingPoint_ReturnsError()
    {
        var result = Validate.Timestamp("123.456", "start");

        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_SpecialCharacters_ReturnsError()
    {
        var result = Validate.Timestamp("'; DROP TABLE", "start");

        Assert.NotNull(result);
    }
}
