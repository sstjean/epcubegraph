using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace EpCubeGraph.Api.Endpoints;

public static class DevicesEndpoints
{
    // Logger category used by all device endpoints; resolved via IServiceProvider in handlers.
    private const string LogCategory = "EpCubeGraph.Api.Endpoints.DevicesEndpoints";
    public static RouteGroupBuilder MapDevicesEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/devices", HandleDevices);
        group.MapGet("/devices/{device}/metrics", HandleDeviceMetrics);
        group.MapGet("/devices/pending-replacements", HandleGetPendingReplacements);
        group.MapPost("/devices/pending-replacements/{id:int}/dismiss", HandleDismissPendingReplacement);
        group.MapGet("/devices/merge-preview", HandleGetMergePreview);
        group.MapPost("/devices/merge", HandlePostMerge);
        group.MapDelete("/devices/{cloudId}", HandleDeleteDevice);

        return group;
    }

    private static async Task<IResult> HandleDevices(
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        [FromQuery] string? status,
        CancellationToken ct)
    {
        var statusError = Validate.DeviceStatus(status, "status");
        if (statusError is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", statusError));

        try
        {
            var devices = await store.GetDevicesAsync(status, ct);
            return Results.Ok(new DeviceListResponse(devices));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "GET /devices failed (status={Status})", status);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleDeviceMetrics(
        string device,
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var error = Validate.SafeName(device, "device");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var metrics = await store.GetDeviceMetricsAsync(device, ct);

            if (metrics.Count == 0)
            {
                return Results.NotFound(new ErrorResponse("error", "not_found", $"No metrics found for device '{device}'"));
            }

            return Results.Ok(new DeviceMetricsResponse(device, metrics));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "GET /devices/{Device}/metrics failed", device);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleGetPendingReplacements(
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        try
        {
            var pending = await store.GetPendingReplacementsAsync(ct);
            return Results.Ok(pending);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "GET /devices/pending-replacements failed");
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleDismissPendingReplacement(
        int id,
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        try
        {
            var result = await store.DismissPendingReplacementAsync(id, ct);
            if (result is null)
            {
                return Results.NotFound(new ErrorResponse("error", "not_found", $"Pending replacement '{id}' not found"));
            }
            return Results.Ok(result);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "POST /devices/pending-replacements/{Id}/dismiss failed", id);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleGetMergePreview(
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        [FromQuery(Name = "old_device_id")] string? oldDeviceId,
        [FromQuery(Name = "new_device_id")] string? newDeviceId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(oldDeviceId) || string.IsNullOrWhiteSpace(newDeviceId))
        {
            return Results.BadRequest(new ErrorResponse("error", "bad_data",
                "old_device_id and new_device_id are required"));
        }
        try
        {
            var preview = await store.GetMergePreviewAsync(oldDeviceId, newDeviceId, ct);
            if (preview is null)
            {
                return Results.NotFound(new ErrorResponse("error", "not_found",
                    $"Devices '{oldDeviceId}' or '{newDeviceId}' not found"));
            }
            return Results.Ok(preview);
        }
        catch (MergeValidationException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "invalid_state", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "GET /devices/merge-preview failed (old={OldId}, new={NewId})", oldDeviceId, newDeviceId);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandlePostMerge(
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        [FromBody] MergeRequest? request,
        CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.OldDeviceId) || string.IsNullOrWhiteSpace(request.NewDeviceId))
        {
            return Results.BadRequest(new ErrorResponse("error", "bad_data",
                "old_device_id and new_device_id are required"));
        }
        try
        {
            var result = await store.ExecuteMergeAsync(request.OldDeviceId, request.NewDeviceId, ct);
            if (result is null)
            {
                return Results.NotFound(new ErrorResponse("error", "not_found",
                    $"Devices '{request.OldDeviceId}' or '{request.NewDeviceId}' not found"));
            }
            return Results.Ok(result);
        }
        catch (MergeValidationException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "invalid_state", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "POST /devices/merge failed (old={OldId}, new={NewId})",
                request.OldDeviceId, request.NewDeviceId);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleDeleteDevice(
        string cloudId,
        IMetricsStore store,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var error = Validate.NumericId(cloudId, "cloudId");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var result = await store.DeleteDeviceAsync(cloudId, ct);
            if (result is null)
            {
                return Results.NotFound(new ErrorResponse("error", "not_found",
                    $"Device '{cloudId}' not found"));
            }
            return Results.Ok(result);
        }
        catch (MergeValidationException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "invalid_state", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger(LogCategory).LogError(ex,
                "DELETE /devices/{CloudId} failed", cloudId);
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }
}
