using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record ErrorResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("errorType")] string ErrorType,
    [property: JsonPropertyName("error")] string Error);
