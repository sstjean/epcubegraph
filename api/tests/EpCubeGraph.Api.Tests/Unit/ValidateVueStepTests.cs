using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateVueStepTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("1s")]
    [InlineData("5m")]
    [InlineData("4h")]
    [InlineData("15s")]
    public void VueStep_ValidInputs_ReturnsNull(string? step)
    {
        // Act
        var result = Validate.VueStep(step, "step");

        // Assert
        Assert.Null(result);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("1x")]
    [InlineData("-1s")]
    [InlineData("0s")]
    [InlineData("0m")]
    [InlineData("0h")]
    [InlineData("s")]
    [InlineData("abcs")]
    [InlineData("xyz.h")]
    public void VueStep_InvalidInputs_ReturnsError(string step)
    {
        // Act
        var result = Validate.VueStep(step, "step");

        // Assert
        Assert.NotNull(result);
    }
}
