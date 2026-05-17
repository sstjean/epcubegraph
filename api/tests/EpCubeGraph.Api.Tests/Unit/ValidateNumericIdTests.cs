using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateNumericIdTests
{
    [Fact]
    public void NumericId_Null_ReturnsRequiredError()
    {
        // Arrange & Act
        var result = Validate.NumericId(null, "cloudId");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'cloudId' is required", result);
    }

    [Fact]
    public void NumericId_Empty_ReturnsRequiredError()
    {
        // Arrange & Act
        var result = Validate.NumericId("", "cloudId");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'cloudId' is required", result);
    }

    [Fact]
    public void NumericId_Whitespace_ReturnsRequiredError()
    {
        // Arrange & Act
        var result = Validate.NumericId("   ", "cloudId");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'cloudId' is required", result);
    }

    [Fact]
    public void NumericId_TooLong_ReturnsLengthError()
    {
        // Arrange — 33 chars
        var value = new string('1', 33);

        // Act
        var result = Validate.NumericId(value, "cloudId");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("32 characters or fewer", result);
    }

    [Fact]
    public void NumericId_ExactlyMaxLength_ReturnsNull()
    {
        // Arrange — 32 chars (boundary)
        var value = new string('1', 32);

        // Act
        var result = Validate.NumericId(value, "cloudId");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void NumericId_NonDigits_ReturnsInvalidError()
    {
        // Arrange & Act
        var result = Validate.NumericId("abc123", "cloudId");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("digits only", result);
    }

    [Fact]
    public void NumericId_ValidDigits_ReturnsNull()
    {
        // Arrange & Act
        var result = Validate.NumericId("5488", "cloudId");

        // Assert
        Assert.Null(result);
    }
}
