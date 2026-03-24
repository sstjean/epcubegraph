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

    public static string? SafeName(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"'{paramName}' is required";
        if (SafeNameRegex().IsMatch(value))
            return null;
        return $"'{paramName}' contains invalid characters";
    }

    [GeneratedRegex(@"^[a-zA-Z_][a-zA-Z0-9_]*$")]
    private static partial Regex SafeNameRegex();
}
