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

    [Fact]
    public void Required_TabCharacter_ReturnsError()
    {
        var result = Validate.Required("\t", "query");

        Assert.NotNull(result);
    }

    [Fact]
    public void Required_NewlineOnly_ReturnsError()
    {
        var result = Validate.Required("\n", "query");

        Assert.NotNull(result);
    }

    [Fact]
    public void Required_MixedWhitespace_ReturnsError()
    {
        var result = Validate.Required(" \t\n ", "query");

        Assert.NotNull(result);
    }

    // ── Timestamp (Unix epoch integers only) ──

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

    // ── StepSeconds (positive integer) ──

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
    public void StepSeconds_PrometheusFormat_ReturnsError()
    {
        // "1m" Prometheus duration format is not valid — must be plain seconds
        var result = Validate.StepSeconds("1m", "step");

        Assert.NotNull(result);
    }

    [Fact]
    public void StepSeconds_WhitespaceOnly_ReturnsError()
    {
        var result = Validate.StepSeconds("   ", "step");

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

    // ── VueStep ──

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
    [InlineData("0m")]
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

    // ── SafeName max length ──

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

    // ── TimeRange ──

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
