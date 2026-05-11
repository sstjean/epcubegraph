using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateSafeNameTests
{
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

    [Fact]
    public void SafeName_SqlInjection_ReturnsError()
    {
        var result = Validate.SafeName("'; DROP TABLE users; --", "device");

        Assert.NotNull(result);
        Assert.Contains("invalid characters", result);
    }

    [Fact]
    public void SafeName_PathTraversal_ReturnsError()
    {
        var result = Validate.SafeName("../etc/passwd", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_UnicodeCharacters_ReturnsError()
    {
        var result = Validate.SafeName("デバイス", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithDots_ReturnsError()
    {
        var result = Validate.SafeName("device.name", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithSlash_ReturnsError()
    {
        var result = Validate.SafeName("device/name", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithAtSign_ReturnsError()
    {
        var result = Validate.SafeName("@device", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_SingleUnderscore_ReturnsNull()
    {
        var result = Validate.SafeName("_", "label");

        Assert.Null(result);
    }

    [Fact]
    public void SafeName_SingleLetter_ReturnsNull()
    {
        var result = Validate.SafeName("a", "label");

        Assert.Null(result);
    }

    [Fact]
    public void SafeName_VeryLongValid_ReturnsNull()
    {
        var result = Validate.SafeName("a" + new string('b', 199), "device");

        Assert.Null(result);
    }

    [Fact]
    public void SafeName_WithCurlyBraces_ReturnsError()
    {
        var result = Validate.SafeName("{device}", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithEqualsSign_ReturnsError()
    {
        var result = Validate.SafeName("device=1", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithNewline_ReturnsError()
    {
        var result = Validate.SafeName("device\nname", "device");

        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_ExceedsMaxLength_ReturnsError()
    {
        // Arrange — 257-character valid name
        var longName = "a" + new string('b', 256);

        // Act
        var result = Validate.SafeName(longName, "metric");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("256", result);
    }

    [Fact]
    public void SafeName_ExactlyMaxLength_ReturnsNull()
    {
        // Arrange — 256-character valid name
        var name = "a" + new string('b', 255);

        // Act
        var result = Validate.SafeName(name, "metric");

        // Assert
        Assert.Null(result);
    }
}
