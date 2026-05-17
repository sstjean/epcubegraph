using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateStepSecondsTests
{
    [Fact]
    public void StepSeconds_Null_ReturnsNull()
    {
        var result = Validate.StepSeconds(null, "step");

        Assert.Null(result);
    }

    [Fact]
    public void StepSeconds_ValidPositive_ReturnsNull()
    {
        var result = Validate.StepSeconds("60", "step");

        Assert.Null(result);
    }

    [Fact]
    public void StepSeconds_One_ReturnsNull()
    {
        var result = Validate.StepSeconds("1", "step");

        Assert.Null(result);
    }

    [Fact]
    public void StepSeconds_LargeNumber_ReturnsNull()
    {
        var result = Validate.StepSeconds("86400", "step");

        Assert.Null(result);
    }

    [Fact]
    public void StepSeconds_Zero_ReturnsError()
    {
        var result = Validate.StepSeconds("0", "step");

        Assert.NotNull(result);
        Assert.Contains("positive integer", result);
    }

    [Fact]
    public void StepSeconds_Negative_ReturnsError()
    {
        var result = Validate.StepSeconds("-1", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_Decimal_ReturnsError()
    {
        var result = Validate.StepSeconds("1.5", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_NonNumeric_ReturnsError()
    {
        var result = Validate.StepSeconds("abc", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_Empty_ReturnsError()
    {
        var result = Validate.StepSeconds("", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_DurationFormat_ReturnsError()
    {
        // "1m" duration format is not valid — must be plain seconds
        var result = Validate.StepSeconds("1m", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_WhitespaceOnly_ReturnsError()
    {
        var result = Validate.StepSeconds("   ", "step");

        Assert.NotNull(result);
    }
}
