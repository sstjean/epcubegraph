using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

// Vue Device & Channel models

public record VueDeviceChannel(
    [property: JsonPropertyName("channel_num")] string ChannelNum,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("channel_type")] string? ChannelType = null);

public record VueDeviceInfo(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("device_name")] string? DeviceName,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("model")] string? Model = null,
    [property: JsonPropertyName("connected")] bool Connected = true,
    [property: JsonPropertyName("last_seen")] long? LastSeen = null,
    [property: JsonPropertyName("channels")] IReadOnlyList<VueDeviceChannel>? Channels = null);

public record VueDevicesResponse(
    [property: JsonPropertyName("devices")] IReadOnlyList<VueDeviceInfo> Devices);

// Vue Readings

public record VueChannelReading(
    [property: JsonPropertyName("channel_num")] string ChannelNum,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("value")] double Value);

public record VueCurrentReadingsResponse(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("timestamp")] long Timestamp,
    [property: JsonPropertyName("channels")] IReadOnlyList<VueChannelReading> Channels);

public record VueChannelSeries(
    [property: JsonPropertyName("channel_num")] string ChannelNum,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("values")] IReadOnlyList<TimeSeriesPoint> Values);

public record VueRangeReadingsResponse(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("start")] string Start,
    [property: JsonPropertyName("end")] string End,
    [property: JsonPropertyName("step")] string Step,
    [property: JsonPropertyName("series")] IReadOnlyList<VueChannelSeries> Series);

// Panel Totals (deduplication)

public record PanelChild(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("raw_total_watts")] double RawTotalWatts);

public record PanelTotalResponse(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("timestamp")] long Timestamp,
    [property: JsonPropertyName("raw_total_watts")] double RawTotalWatts,
    [property: JsonPropertyName("deduplicated_total_watts")] double DeduplicatedTotalWatts,
    [property: JsonPropertyName("children")] IReadOnlyList<PanelChild> Children);

public record PanelTotalRangeResponse(
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("display_name")] string DisplayName,
    [property: JsonPropertyName("start")] string Start,
    [property: JsonPropertyName("end")] string End,
    [property: JsonPropertyName("step")] string Step,
    [property: JsonPropertyName("raw_total")] IReadOnlyList<TimeSeriesPoint> RawTotal,
    [property: JsonPropertyName("deduplicated_total")] IReadOnlyList<TimeSeriesPoint> DeduplicatedTotal);

// Home Total (sum of top-level panels)

public record HomeTotalResponse(
    [property: JsonPropertyName("timestamp")] long Timestamp,
    [property: JsonPropertyName("total_watts")] double TotalWatts,
    [property: JsonPropertyName("panels")] IReadOnlyList<PanelChild> Panels);

public record HomeTotalRangeResponse(
    [property: JsonPropertyName("start")] string Start,
    [property: JsonPropertyName("end")] string End,
    [property: JsonPropertyName("step")] string Step,
    [property: JsonPropertyName("total")] IReadOnlyList<TimeSeriesPoint> Total);
