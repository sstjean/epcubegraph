using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record DeviceInfo(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("class")] string DeviceClass,
    [property: JsonPropertyName("manufacturer")] string? Manufacturer = null,
    [property: JsonPropertyName("product_code")] string? ProductCode = null,
    [property: JsonPropertyName("uid")] string? Uid = null,
    [property: JsonPropertyName("online")] bool Online = false,
    [property: JsonPropertyName("alias")] string? Alias = null);

public record DeviceListResponse(
    [property: JsonPropertyName("devices")] IReadOnlyList<DeviceInfo> Devices);

public record DeviceMetricsResponse(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("metrics")] IReadOnlyList<string> Metrics);

public record ErrorResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("errorType")] string ErrorType,
    [property: JsonPropertyName("error")] string Error);

public record HealthResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("victoriametrics")] string VictoriaMetrics);
