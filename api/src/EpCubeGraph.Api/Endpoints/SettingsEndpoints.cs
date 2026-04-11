using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace EpCubeGraph.Api.Endpoints;

public static class SettingsEndpoints
{
    private static readonly HashSet<string> PollIntervalKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "epcube_poll_interval_seconds",
        "vue_poll_interval_seconds",
        "vue_daily_poll_interval_seconds",
    };

    private const string VueDeviceMappingKey = "vue_device_mapping";

    public static RouteGroupBuilder MapSettingsEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/settings", HandleGetSettings)
            .RequireAuthorization()
            .Produces<SettingsResponse>();

        group.MapPut("/settings/{key}", HandleUpdateSetting)
            .RequireAuthorization()
            .Produces<SettingEntry>()
            .Produces<ErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapGet("/settings/hierarchy", HandleGetHierarchy)
            .RequireAuthorization()
            .Produces<PanelHierarchyResponse>();

        group.MapPut("/settings/hierarchy", HandleUpdateHierarchy)
            .RequireAuthorization()
            .Produces<PanelHierarchyResponse>()
            .Produces<ErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapGet("/settings/display-names", HandleGetDisplayNames)
            .RequireAuthorization()
            .Produces<DisplayNamesResponse>();

        group.MapPut("/settings/display-names/{deviceGid:long}", HandleUpdateDisplayNames)
            .RequireAuthorization()
            .Produces<DisplayNamesResponse>();

        group.MapDelete("/settings/display-names/{deviceGid:long}/{channelNumber}", HandleDeleteDisplayName)
            .RequireAuthorization()
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound);

        return group;
    }

    private static async Task<IResult> HandleGetSettings(ISettingsStore store, CancellationToken ct)
    {
        var settings = await store.GetAllSettingsAsync(ct);
        return Results.Ok(new SettingsResponse(settings));
    }

    private static async Task<IResult> HandleUpdateSetting(
        [FromRoute] string key, [FromBody] SettingUpdateRequest request, ISettingsStore store, CancellationToken ct)
    {
        if (key == VueDeviceMappingKey)
        {
            return await HandleUpdateVueDeviceMapping(request, store, ct);
        }

        if (!PollIntervalKeys.Contains(key))
        {
            return Results.BadRequest(new ErrorResponse(
                "error", "validation", $"Unknown setting key '{key}'. Allowed keys: {string.Join(", ", PollIntervalKeys)}, {VueDeviceMappingKey}"));
        }

        if (!int.TryParse(request.Value, out var interval) || interval < 1 || interval > 3600)
        {
            return Results.BadRequest(new ErrorResponse(
                "error", "validation", "Polling interval must be an integer between 1 and 3600 seconds"));
        }

        var entry = await store.UpdateSettingAsync(key, request.Value, ct);
        return Results.Ok(entry);
    }

    private static async Task<IResult> HandleUpdateVueDeviceMapping(
        SettingUpdateRequest request, ISettingsStore store, CancellationToken ct)
    {
        // Parse JSON
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(request.Value);
        }
        catch (JsonException)
        {
            return Results.BadRequest(new ErrorResponse(
                "error", "validation", "Invalid JSON in vue_device_mapping value"));
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return Results.BadRequest(new ErrorResponse(
                    "error", "validation", "Invalid JSON in vue_device_mapping value"));
            }

            // Validate structure and collect GIDs for duplicate check
            var seenGids = new HashSet<long>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                if (prop.Value.ValueKind != JsonValueKind.Array)
                {
                    return Results.BadRequest(new ErrorResponse(
                        "error", "validation", "vue_device_mapping values must be arrays of objects with gid and alias"));
                }

                foreach (var panel in prop.Value.EnumerateArray())
                {
                    if (panel.ValueKind != JsonValueKind.Object ||
                        !panel.TryGetProperty("gid", out var gidProp) ||
                        !panel.TryGetProperty("alias", out var aliasProp) ||
                        aliasProp.ValueKind != JsonValueKind.String)
                    {
                        return Results.BadRequest(new ErrorResponse(
                            "error", "validation", "vue_device_mapping values must be arrays of objects with gid and alias"));
                    }

                    if (!gidProp.TryGetInt64(out var gid))
                    {
                        return Results.BadRequest(new ErrorResponse(
                            "error", "validation", "vue_device_mapping values must be arrays of objects with gid and alias"));
                    }

                    if (!seenGids.Add(gid))
                    {
                        return Results.BadRequest(new ErrorResponse(
                            "error", "validation", $"Vue device GID {gid} is mapped to multiple EP Cube devices"));
                    }
                }
            }
        }

        var entry = await store.UpdateSettingAsync(VueDeviceMappingKey, request.Value, ct);
        return Results.Ok(entry);
    }

    private static async Task<IResult> HandleGetHierarchy(ISettingsStore store, CancellationToken ct)
    {
        var entries = await store.GetHierarchyAsync(ct);
        return Results.Ok(new PanelHierarchyResponse(entries));
    }

    private static async Task<IResult> HandleUpdateHierarchy(
        [FromBody] PanelHierarchyRequest request, ISettingsStore store, CancellationToken ct)
    {
        var edges = request.Entries;

        // Validate no duplicate edges
        var edgeSet = new HashSet<(long, long)>();
        foreach (var e in edges)
        {
            if (!edgeSet.Add((e.ParentDeviceGid, e.ChildDeviceGid)))
            {
                return Results.BadRequest(new ErrorResponse(
                    "error", "validation", $"Duplicate edge: {e.ParentDeviceGid} → {e.ChildDeviceGid}"));
            }
        }

        // Validate no circular references
        if (HasCycle(edges))
        {
            return Results.BadRequest(new ErrorResponse(
                "error", "validation", "Panel hierarchy contains a circular reference"));
        }

        var entries = await store.UpdateHierarchyAsync(edges, ct);
        return Results.Ok(new PanelHierarchyResponse(entries));
    }

    private static async Task<IResult> HandleGetDisplayNames(ISettingsStore store, CancellationToken ct)
    {
        var overrides = await store.GetDisplayNamesAsync(ct);
        return Results.Ok(new DisplayNamesResponse(overrides));
    }

    private static async Task<IResult> HandleUpdateDisplayNames(
        [FromRoute] long deviceGid, [FromBody] DisplayNameUpdateRequest request, ISettingsStore store, CancellationToken ct)
    {
        // Validate no duplicate channel numbers
        var channelSet = new HashSet<string?>();
        foreach (var o in request.Overrides)
        {
            if (!channelSet.Add(o.ChannelNumber))
            {
                return Results.BadRequest(new ErrorResponse(
                    "error", "validation", $"Duplicate channel number: {o.ChannelNumber ?? "(device-level)"}"));
            }
        }

        var result = await store.UpdateDisplayNamesForDeviceAsync(deviceGid, request.Overrides, ct);
        return Results.Ok(new DisplayNamesResponse(result));
    }

    private static async Task<IResult> HandleDeleteDisplayName(
        long deviceGid, string channelNumber, ISettingsStore store, CancellationToken ct)
    {
        var deleted = await store.DeleteDisplayNameAsync(deviceGid, channelNumber, ct);
        return deleted ? Results.NoContent() : Results.NotFound();
    }

    /// <summary>
    /// Detects cycles in the panel hierarchy using DFS.
    /// Returns true if any node can reach itself through the edges.
    /// </summary>
    public static bool HasCycle(IReadOnlyList<PanelHierarchyInputEntry> edges)
    {
        var adjacency = new Dictionary<long, List<long>>();
        foreach (var e in edges)
        {
            if (e.ParentDeviceGid == e.ChildDeviceGid) return true; // self-reference
            if (!adjacency.ContainsKey(e.ParentDeviceGid))
                adjacency[e.ParentDeviceGid] = new List<long>();
            adjacency[e.ParentDeviceGid].Add(e.ChildDeviceGid);
        }

        var visited = new HashSet<long>();
        var inStack = new HashSet<long>();

        bool Dfs(long node)
        {
            if (inStack.Contains(node)) return true;
            if (visited.Contains(node)) return false;
            visited.Add(node);
            inStack.Add(node);
            if (adjacency.TryGetValue(node, out var children))
            {
                foreach (var child in children)
                    if (Dfs(child)) return true;
            }
            inStack.Remove(node);
            return false;
        }

        foreach (var node in adjacency.Keys)
            if (Dfs(node)) return true;

        return false;
    }
}
