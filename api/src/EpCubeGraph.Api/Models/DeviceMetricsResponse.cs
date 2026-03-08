using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record DeviceMetricsResponse(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("metrics")] IReadOnlyList<string> Metrics);
