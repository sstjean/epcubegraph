using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record HealthResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("victoriametrics")] string VictoriaMetrics);
