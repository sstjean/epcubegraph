using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record DeviceListResponse(
    [property: JsonPropertyName("devices")] IReadOnlyList<DeviceInfo> Devices);
