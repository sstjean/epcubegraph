using System.Text.Json.Serialization;

namespace EpCubeGraph.Api.Models;

// Settings — key-value configuration entries (e.g., polling intervals)

public record SettingEntry(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("value")] string Value,
    [property: JsonPropertyName("last_modified")] DateTimeOffset LastModified);

public record SettingUpdateRequest(
    [property: JsonPropertyName("value")] string Value);

public record SettingsResponse(
    [property: JsonPropertyName("settings")] IReadOnlyList<SettingEntry> Settings);

// Panel Hierarchy — parent-child relationships for deduplication

public record PanelHierarchyEntry(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("parent_device_gid")] long ParentDeviceGid,
    [property: JsonPropertyName("child_device_gid")] long ChildDeviceGid);

public record PanelHierarchyRequest(
    [property: JsonPropertyName("entries")] IReadOnlyList<PanelHierarchyInputEntry> Entries);

public record PanelHierarchyInputEntry(
    [property: JsonPropertyName("parent_device_gid")] long ParentDeviceGid,
    [property: JsonPropertyName("child_device_gid")] long ChildDeviceGid);

public record PanelHierarchyResponse(
    [property: JsonPropertyName("entries")] IReadOnlyList<PanelHierarchyEntry> Entries);

// Display Name Overrides — custom names for devices and circuits

public record DisplayNameOverride(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("device_gid")] long DeviceGid,
    [property: JsonPropertyName("channel_number")] string? ChannelNumber,
    [property: JsonPropertyName("display_name")] string DisplayName);

public record DisplayNameUpdateRequest(
    [property: JsonPropertyName("overrides")] IReadOnlyList<DisplayNameInputEntry> Overrides);

public record DisplayNameInputEntry(
    [property: JsonPropertyName("channel_number")] string? ChannelNumber,
    [property: JsonPropertyName("display_name")] string DisplayName);

public record DisplayNamesResponse(
    [property: JsonPropertyName("overrides")] IReadOnlyList<DisplayNameOverride> Overrides);
