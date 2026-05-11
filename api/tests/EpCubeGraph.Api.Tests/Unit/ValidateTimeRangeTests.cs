using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateTimeRangeTests
{
    [Fact]
    public void TimeRange_StartBeforeEnd_ReturnsNull()
    {
        var result = Validate.TimeRange("1000", "2000");

        Assert.Null(result);
    }

    [Fact]
    public void TimeRange_StartEqualsEnd_ReturnsError()
    {
        var result = Validate.TimeRange("1000", "1000");

        Assert.NotNull(result);
        Assert.Contains("'start' must be before 'end'", result);
    }

    [Fact]
    public void TimeRange_StartAfterEnd_ReturnsError()
    {
        var result = Validate.TimeRange("2000", "1000");

        Assert.NotNull(result);
        Assert.Contains("'start' must be before 'end'", result);
    }

    [Fact]
    public void TimeRange_NullStart_ReturnsNull()
    {
        // TimeRange is called after Required/Timestamp — nulls already caught
        var result = Validate.TimeRange(null, "2000");

        Assert.Null(result);
    }

    [Fact]
    public void TimeRange_NullEnd_ReturnsNull()
    {
        var result = Validate.TimeRange("1000", null);

        Assert.Null(result);
    }

    [Fact]
    public void TimeRange_NonNumericStart_ReturnsNull()
    {
        // Defensive guard — Timestamp() already rejects, but TimeRange handles gracefully
        var result = Validate.TimeRange("abc", "2000");

        Assert.Null(result);
    }

    [Fact]
    public void TimeRange_NonNumericEnd_ReturnsNull()
    {
        var result = Validate.TimeRange("1000", "xyz");

        Assert.Null(result);
    }
}
