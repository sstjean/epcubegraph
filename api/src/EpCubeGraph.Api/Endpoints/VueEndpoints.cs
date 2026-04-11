using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;

namespace EpCubeGraph.Api.Endpoints;

public static class VueEndpoints
{
    public static RouteGroupBuilder MapVueEndpoints(this RouteGroupBuilder group)
    {
        // Devices
        group.MapGet("/vue/devices", HandleGetDevices)
            .Produces<VueDevicesResponse>();
        group.MapGet("/vue/devices/{deviceGid:long}/readings/current", HandleGetCurrentReadings)
            .Produces<VueCurrentReadingsResponse>()
            .Produces(404);
        group.MapGet("/vue/devices/{deviceGid:long}/readings/range", HandleGetRangeReadings)
            .Produces<VueRangeReadingsResponse>()
            .Produces(404);

        // Bulk readings
        group.MapGet("/vue/readings/current", HandleGetBulkCurrentReadings)
            .Produces<VueBulkCurrentReadingsResponse>();
        group.MapGet("/vue/readings/daily", HandleGetDailyReadings)
            .Produces<VueBulkDailyReadingsResponse>()
            .Produces(400);

        // Panel Totals
        group.MapGet("/vue/panels/{deviceGid:long}/total", HandleGetPanelTotal)
            .Produces<PanelTotalResponse>()
            .Produces(404);
        group.MapGet("/vue/panels/{deviceGid:long}/total/range", HandleGetPanelTotalRange)
            .Produces<PanelTotalRangeResponse>()
            .Produces(404);

        // Home Total
        group.MapGet("/vue/home/total", HandleGetHomeTotal)
            .Produces<HomeTotalResponse>();
        group.MapGet("/vue/home/total/range", HandleGetHomeTotalRange)
            .Produces<HomeTotalRangeResponse>();

        return group;
    }

    // ── Devices ──

    private static async Task<IResult> HandleGetDevices(IVueStore store, CancellationToken ct)
    {
        var devices = await store.GetDevicesAsync(ct);
        return Results.Ok(new VueDevicesResponse(devices));
    }

    private static async Task<IResult> HandleGetCurrentReadings(
        [FromRoute] long deviceGid, IVueStore store, CancellationToken ct)
    {
        var result = await store.GetCurrentReadingsAsync(deviceGid, ct);
        return result is null
            ? Results.NotFound(new ErrorResponse("error", "not_found", $"Device {deviceGid} not found or has no readings"))
            : Results.Ok(result);
    }

    private static async Task<IResult> HandleGetRangeReadings(
        [FromRoute] long deviceGid,
        [FromQuery] DateTimeOffset start, [FromQuery] DateTimeOffset end,
        [FromQuery] string? step, [FromQuery] string? channels,
        IVueStore store, CancellationToken ct)
    {
        if (start >= end)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", "'start' must be before 'end'"));
        var stepErr = Validate.VueStep(step, "step");
        if (stepErr is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", stepErr));
        var result = await store.GetRangeReadingsAsync(deviceGid, start, end, step, channels, ct);
        return result is null
            ? Results.NotFound(new ErrorResponse("error", "not_found", $"No readings for device {deviceGid} in range"))
            : Results.Ok(result);
    }

    // ── Panel Totals ──

    private static async Task<IResult> HandleGetPanelTotal(
        [FromRoute] long deviceGid, IVueStore store, CancellationToken ct)
    {
        var result = await store.GetPanelTotalAsync(deviceGid, ct);
        return result is null
            ? Results.NotFound(new ErrorResponse("error", "not_found", $"Panel {deviceGid} not found or has no mains data"))
            : Results.Ok(result);
    }

    private static async Task<IResult> HandleGetPanelTotalRange(
        [FromRoute] long deviceGid,
        [FromQuery] DateTimeOffset start, [FromQuery] DateTimeOffset end,
        [FromQuery] string? step,
        IVueStore store, CancellationToken ct)
    {
        if (start >= end)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", "'start' must be before 'end'"));
        var stepErr = Validate.VueStep(step, "step");
        if (stepErr is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", stepErr));
        var result = await store.GetPanelTotalRangeAsync(deviceGid, start, end, step, ct);
        return result is null
            ? Results.NotFound(new ErrorResponse("error", "not_found", $"No mains data for panel {deviceGid} in range"))
            : Results.Ok(result);
    }

    // ── Home Total ──

    private static async Task<IResult> HandleGetHomeTotal(IVueStore store, CancellationToken ct)
    {
        var result = await store.GetHomeTotalAsync(ct);
        return Results.Ok(result);
    }

    private static async Task<IResult> HandleGetHomeTotalRange(
        [FromQuery] DateTimeOffset start, [FromQuery] DateTimeOffset end,
        [FromQuery] string? step,
        IVueStore store, CancellationToken ct)
    {
        if (start >= end)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", "'start' must be before 'end'"));
        var stepErr = Validate.VueStep(step, "step");
        if (stepErr is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_request", stepErr));
        var result = await store.GetHomeTotalRangeAsync(start, end, step, ct);
        return Results.Ok(result);
    }

    // ── Bulk Readings ──

    private static async Task<IResult> HandleGetBulkCurrentReadings(IVueStore store, CancellationToken ct)
    {
        var result = await store.GetBulkCurrentReadingsAsync(ct);
        return Results.Ok(result);
    }

    private static async Task<IResult> HandleGetDailyReadings(
        [FromQuery] string? date, IVueStore store, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(date))
            return Results.BadRequest(new ErrorResponse("error", "bad_request", "'date' query parameter is required"));
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
            return Results.BadRequest(new ErrorResponse("error", "bad_request", $"Invalid date format: '{date}'. Use ISO format (e.g. 2026-04-09)"));
        var result = await store.GetDailyReadingsAsync(parsedDate, ct);
        return Results.Ok(result);
    }
}
