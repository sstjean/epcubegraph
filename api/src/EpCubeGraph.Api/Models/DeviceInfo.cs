using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record DeviceInfo(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("class")] string DeviceClass,
    [property: JsonPropertyName("ip")] string Ip,
    [property: JsonPropertyName("manufacturer")] string? Manufacturer = null,
    [property: JsonPropertyName("product_code")] string? ProductCode = null,
    [property: JsonPropertyName("uid")] string? Uid = null,
    [property: JsonPropertyName("online")] bool Online = false);
