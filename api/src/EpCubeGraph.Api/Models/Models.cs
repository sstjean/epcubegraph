using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

public record DeviceInfo(
    [property: JsonPropertyName("device")] string Device,
    [property: JsonPropertyName("class")] string DeviceClass,
    [property: JsonPropertyName("manufacturer")] string? Manufacturer = null,
    [property: JsonPropertyName("product_code")] string? ProductCode = null,
    [property: JsonPropertyName("uid")] string? Uid = null,
    [property: JsonPropertyName("online")] bool Online = false,
    [property: JsonPropertyName("alias")] string? Alias = null,
    [property: JsonPropertyName("created_at")] DateTimeOffset? CreatedAt = null,
    [property: JsonPropertyName("updated_at")] DateTimeOffset? UpdatedAt = null,
    [property: JsonPropertyName("status")] string? Status = null);

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
    [property: JsonPropertyName("datastore")] string Datastore);

public record Reading(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("timestamp")] long Timestamp,
    [property: JsonPropertyName("value")] double Value);

public record CurrentReadingsResponse(
    [property: JsonPropertyName("metric")] string Metric,
    [property: JsonPropertyName("readings")] IReadOnlyList<Reading> Readings);

public record TimeSeriesPoint(
    [property: JsonPropertyName("timestamp")] long Timestamp,
    [property: JsonPropertyName("value")] double Value);

public record TimeSeries(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("values")] IReadOnlyList<TimeSeriesPoint> Values);

public record RangeReadingsResponse(
    [property: JsonPropertyName("metric")] string Metric,
    [property: JsonPropertyName("series")] IReadOnlyList<TimeSeries> Series);

// Device discovery & merge models

public record PendingReplacement(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("old_device_id")] string OldDeviceId,
    [property: JsonPropertyName("new_device_id")] string NewDeviceId,
    [property: JsonPropertyName("detected_at")] DateTimeOffset DetectedAt,
    [property: JsonPropertyName("old_product_code")] string? OldProductCode = null,
    [property: JsonPropertyName("old_alias")] string? OldAlias = null,
    [property: JsonPropertyName("new_product_code")] string? NewProductCode = null,
    [property: JsonPropertyName("new_alias")] string? NewAlias = null,
    [property: JsonPropertyName("old_last_seen")] DateTimeOffset? OldLastSeen = null,
    [property: JsonPropertyName("new_last_seen")] DateTimeOffset? NewLastSeen = null);

public record MergeRequest(
    [property: JsonPropertyName("old_device_id")] string OldDeviceId,
    [property: JsonPropertyName("new_device_id")] string NewDeviceId);

public record MergePreviewResponse(
    [property: JsonPropertyName("old_device_id")] string OldDeviceId,
    [property: JsonPropertyName("new_device_id")] string NewDeviceId,
    [property: JsonPropertyName("readings_to_transfer")] long ReadingsToTransfer,
    [property: JsonPropertyName("conflicts_to_skip")] long ConflictsToSkip);

public record MergeResponse(
    [property: JsonPropertyName("old_device_id")] string OldDeviceId,
    [property: JsonPropertyName("new_device_id")] string NewDeviceId,
    [property: JsonPropertyName("readings_transferred")] long ReadingsTransferred,
    [property: JsonPropertyName("conflicts_skipped")] long ConflictsSkipped);

public record DismissResponse(
    [property: JsonPropertyName("dismissed")] bool Dismissed,
    [property: JsonPropertyName("old_device_id")] string OldDeviceId,
    [property: JsonPropertyName("new_device_id")] string NewDeviceId);

public record DeleteDeviceResponse(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("readings_deleted")] long ReadingsDeleted);
