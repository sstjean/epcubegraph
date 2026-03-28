using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class DevicesEndpoints
{
    public static RouteGroupBuilder MapDevicesEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/devices", HandleDevices);
        group.MapGet("/devices/{device}/metrics", HandleDeviceMetrics);

        return group;
    }

    private static async Task<IResult> HandleDevices(
        IMetricsStore store,
        CancellationToken ct)
    {
        try
        {
            var devices = await store.GetDevicesAsync(ct);
            return Results.Ok(new DeviceListResponse(devices));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleDeviceMetrics(
        string device,
        IMetricsStore store,
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
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }
}
