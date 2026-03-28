using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class ReadingsEndpoints
{
    public static RouteGroupBuilder MapReadingsEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/readings/current", HandleCurrentReadings);
        group.MapGet("/readings/range", HandleRangeReadings);

        return group;
    }

    private static async Task<IResult> HandleCurrentReadings(
        string? metric,
        IMetricsStore store,
        CancellationToken ct)
    {
        var error = Validate.Required(metric, "metric")
            ?? Validate.SafeName(metric, "metric");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var readings = await store.GetCurrentReadingsAsync(metric!, ct);
            return Results.Ok(new CurrentReadingsResponse(metric!, readings));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleRangeReadings(
        string? metric,
        string? start,
        string? end,
        string? step,
        IMetricsStore store,
        CancellationToken ct)
    {
        var error = Validate.Required(metric, "metric")
            ?? Validate.SafeName(metric, "metric")
            ?? Validate.Required(start, "start")
            ?? Validate.Required(end, "end")
            ?? Validate.Required(step, "step")
            ?? Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end")
            ?? Validate.StepSeconds(step, "step");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var startEpoch = long.Parse(start!);
            var endEpoch = long.Parse(end!);
            var stepSec = int.Parse(step!);

            var series = await store.GetRangeReadingsAsync(metric!, startEpoch, endEpoch, stepSec, ct);
            return Results.Ok(new RangeReadingsResponse(metric!, series));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

}
