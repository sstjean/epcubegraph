using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateTests
{
    // ── Required ──

    [Fact]
    public void Required_Null_ReturnsError()
    {
        // Act
        var result = Validate.Required(null, "query");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Empty_ReturnsError()
    {
        // Act
        var result = Validate.Required("", "query");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Whitespace_ReturnsError()
    {
        // Act
        var result = Validate.Required("   ", "query");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Required_ValidValue_ReturnsNull()
    {
        // Act
        var result = Validate.Required("up", "query");

        // Assert
        Assert.Null(result);
    }

    // ── Timestamp ──

    [Fact]
    public void Timestamp_Null_ReturnsNull()
    {
        // Optional — null is valid

        // Act
        var result = Validate.Timestamp(null, "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_UnixEpoch_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("1709827200", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Rfc3339_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("2026-03-07T00:00:00Z", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Invalid_ReturnsError()
    {
        // Act
        var result = Validate.Timestamp("not-a-time", "start");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'start'", result);
        Assert.Contains("RFC3339", result);
    }

    [Fact]
    public void Timestamp_Empty_ReturnsError()
    {
        // Act
        var result = Validate.Timestamp("", "time");

        // Assert
        Assert.NotNull(result);
    }

    // ── Duration ──

    [Fact]
    public void Duration_Null_ReturnsNull()
    {
        // Optional — null is valid

        // Act
        var result = Validate.Duration(null, "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidMinutes_ReturnsNull()
    {
        // Act
        var result = Validate.Duration("1m", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidHours_ReturnsNull()
    {
        // Act
        var result = Validate.Duration("1h", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidSeconds_ReturnsNull()
    {
        // Act
        var result = Validate.Duration("30s", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_ValidDays_ReturnsNull()
    {
        // Act
        var result = Validate.Duration("7d", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_Invalid_ReturnsError()
    {
        // Act
        var result = Validate.Duration("abc", "step");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'step'", result);
        Assert.Contains("duration", result);
    }

    [Fact]
    public void Duration_Empty_ReturnsError()
    {
        // Act
        var result = Validate.Duration("", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_NoUnit_ReturnsError()
    {
        // Act
        var result = Validate.Duration("123", "step");

        // Assert
        Assert.NotNull(result);
    }

    // ── SafeName ──

    [Fact]
    public void SafeName_Null_ReturnsError()
    {
        // Act
        var result = Validate.SafeName(null, "device");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("'device' is required", result);
    }

    [Fact]
    public void SafeName_ValidIdentifier_ReturnsNull()
    {
        // Act
        var result = Validate.SafeName("epcube_battery", "device");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_ValidWithUnderscore_ReturnsNull()
    {
        // Act
        var result = Validate.SafeName("__name__", "label");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_ValidAlphaNumeric_ReturnsNull()
    {
        // Act
        var result = Validate.SafeName("device123", "name");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_InvalidWithDash_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("some-device", "device");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("invalid characters", result);
    }

    [Fact]
    public void SafeName_InvalidStartsWithNumber_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("123device", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_InvalidWithSpaces_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("ep cube", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_Empty_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("", "device");

        // Assert
        Assert.NotNull(result);
    }

    // ── Edge Cases: Required ──

    [Fact]
    public void Required_TabCharacter_ReturnsError()
    {
        // Act
        var result = Validate.Required("\t", "query");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Required_NewlineOnly_ReturnsError()
    {
        // Act
        var result = Validate.Required("\n", "query");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Required_MixedWhitespace_ReturnsError()
    {
        // Act
        var result = Validate.Required(" \t\n ", "query");

        // Assert
        Assert.NotNull(result);
    }

    // ── Edge Cases: Timestamp ──

    [Fact]
    public void Timestamp_NegativeEpoch_ReturnsNull()
    {
        // Negative Unix epoch (before 1970) — long.TryParse succeeds

        // Act
        var result = Validate.Timestamp("-1", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Zero_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("0", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_VeryLargeEpoch_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("99999999999", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_WhitespaceOnly_ReturnsError()
    {
        // Act
        var result = Validate.Timestamp("   ", "start");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_Rfc3339_WithOffset_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("2026-03-07T09:00:00+09:00", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_Rfc3339_WithFractionalSeconds_ReturnsNull()
    {
        // Act
        var result = Validate.Timestamp("2026-03-07T00:00:00.123Z", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_DateOnly_ReturnsNull()
    {
        // DateTimeOffset.TryParse can parse date-only strings

        // Act
        var result = Validate.Timestamp("2026-03-07", "start");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Timestamp_FloatingPoint_ReturnsError()
    {
        // "123.456" is not a valid long, but DateTimeOffset.TryParse also fails

        // Act
        var result = Validate.Timestamp("123.456", "start");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Timestamp_SpecialCharacters_ReturnsError()
    {
        // Act
        var result = Validate.Timestamp("'; DROP TABLE", "start");

        // Assert
        Assert.NotNull(result);
    }

    // ── Edge Cases: Duration ──

    [Fact]
    public void Duration_ZeroSeconds_ReturnsNull()
    {
        // "0s" matches ^\d+[smhd]$

        // Act
        var result = Validate.Duration("0s", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_LargeNumber_ReturnsNull()
    {
        // Act
        var result = Validate.Duration("999999m", "step");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void Duration_Milliseconds_ReturnsError()
    {
        // "1ms" — multi-char suffix not supported

        // Act
        var result = Validate.Duration("1ms", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_Weeks_ReturnsError()
    {
        // "1w" — 'w' not in [smhd]

        // Act
        var result = Validate.Duration("1w", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_Negative_ReturnsError()
    {
        // Act
        var result = Validate.Duration("-1m", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_WhitespaceOnly_ReturnsError()
    {
        // Act
        var result = Validate.Duration("   ", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_UnitOnly_ReturnsError()
    {
        // Act
        var result = Validate.Duration("m", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_DecimalValue_ReturnsError()
    {
        // Act
        var result = Validate.Duration("1.5m", "step");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void Duration_WithSpaces_ReturnsError()
    {
        // Act
        var result = Validate.Duration("1 m", "step");

        // Assert
        Assert.NotNull(result);
    }

    // ── Edge Cases: SafeName ──

    [Fact]
    public void SafeName_SqlInjection_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("'; DROP TABLE users; --", "device");

        // Assert
        Assert.NotNull(result);
        Assert.Contains("invalid characters", result);
    }

    [Fact]
    public void SafeName_PathTraversal_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("../etc/passwd", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_UnicodeCharacters_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("デバイス", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithDots_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("device.name", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithSlash_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("device/name", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithAtSign_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("@device", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_SingleUnderscore_ReturnsNull()
    {
        // Act
        var result = Validate.SafeName("_", "label");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_SingleLetter_ReturnsNull()
    {
        // Act
        var result = Validate.SafeName("a", "label");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_VeryLongValid_ReturnsNull()
    {
        // 200-char valid identifier

        // Act
        var result = Validate.SafeName("a" + new string('b', 199), "device");

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public void SafeName_WithCurlyBraces_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("{device}", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithEqualsSign_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("device=1", "device");

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public void SafeName_WithNewline_ReturnsError()
    {
        // Act
        var result = Validate.SafeName("device\nname", "device");

        // Assert
        Assert.NotNull(result);
    }
}
