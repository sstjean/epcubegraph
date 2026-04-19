using System.Text.RegularExpressions;

namespace EpCubeGraph.Api;

/// <summary>
/// Input validation helpers for API endpoints.
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
            return $"'{paramName}' must be a valid Unix epoch (integer seconds)";
        if (long.TryParse(value, out _)) return null; // Unix epoch
        return $"'{paramName}' must be a valid Unix epoch (integer seconds)";
    }

    /// <summary>
    /// Validates step as a positive integer (seconds).
    /// </summary>
    public static string? StepSeconds(string? value, string paramName)
    {
        if (value is null) return null; // optional
        if (int.TryParse(value, out var step) && step > 0) return null;
        return $"'{paramName}' must be a positive integer (seconds)";
    }

    /// <summary>
    /// Validates Vue step format: &lt;number&gt;s, &lt;number&gt;m, or &lt;number&gt;h.
    /// </summary>
    public static string? VueStep(string? value, string paramName)
    {
        if (value is null) return null; // optional (auto-resolved)
        if (value.Length >= 2 && "smh".Contains(value[^1]))
        {
            if (int.TryParse(value[..^1], out var n) && n > 0) return null;
        }
        return $"'{paramName}' must be <number>s, <number>m, or <number>h (e.g. 5s, 1m, 4h)";
    }

    public static string? SafeName(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"'{paramName}' is required";
        if (value.Length > 256)
            return $"'{paramName}' must be 256 characters or fewer";
        if (SafeNameRegex().IsMatch(value))
            return null;
        return $"'{paramName}' contains invalid characters";
    }

    /// <summary>
    /// Validates that start is strictly before end. Both must be valid epoch strings.
    /// Call after Required + Timestamp validation — null inputs are skipped.
    /// </summary>
    public static string? TimeRange(string? start, string? end)
    {
        if (start is null || end is null) return null;
        if (!long.TryParse(start, out var s) || !long.TryParse(end, out var e)) return null;
        if (s >= e) return "'start' must be before 'end'";
        return null;
    }

    [GeneratedRegex(@"^[a-zA-Z_][a-zA-Z0-9_]*$")]
    private static partial Regex SafeNameRegex();
}
