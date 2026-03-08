using System.Text.RegularExpressions;

namespace EpCubeGraph.Api;

/// <summary>
/// Input validation helpers for API endpoints (FR-019).
/// Each method returns null on valid input, or an error message string on invalid input.
/// </summary>
public static partial class Validate
{
    public static string? Required(string? value, string paramName)
        => string.IsNullOrWhiteSpace(value) ? $"'{paramName}' is required" : null;

    public static string? Timestamp(string? value, string paramName)
    {
        if (value is null) return null; // optional
        if (string.IsNullOrWhiteSpace(value))
            return $"'{paramName}' must be a valid RFC3339 timestamp or Unix epoch";
        if (long.TryParse(value, out _)) return null; // Unix epoch
        if (DateTimeOffset.TryParse(value, out _)) return null; // RFC3339
        return $"'{paramName}' must be a valid RFC3339 timestamp or Unix epoch";
    }

    public static string? Duration(string? value, string paramName)
    {
        if (value is null) return null; // optional
        if (DurationRegex().IsMatch(value))
            return null;
        return $"'{paramName}' must be a valid duration (e.g., 1m, 5m, 1h, 1d)";
    }

    public static string? SafeName(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"'{paramName}' is required";
        if (SafeNameRegex().IsMatch(value))
            return null;
        return $"'{paramName}' contains invalid characters";
    }

    [GeneratedRegex(@"^\d+[smhd]$")]
    private static partial Regex DurationRegex();

    [GeneratedRegex(@"^[a-zA-Z_][a-zA-Z0-9_]*$")]
    private static partial Regex SafeNameRegex();
}
