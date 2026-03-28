using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class GridEndpoints
{
    public static RouteGroupBuilder MapGridEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/grid", HandleGrid);

        return group;
    }

    private static async Task<IResult> HandleGrid(
        string? start,
        string? end,
        string? step,
        IMetricsStore store,
        CancellationToken ct)
    {
        var error = Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end")
            ?? Validate.StepSeconds(step, "step");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        var now = DateTimeOffset.UtcNow;
        var effectiveEnd = end is not null ? long.Parse(end) : now.ToUnixTimeSeconds();
        var effectiveStart = start is not null ? long.Parse(start) : now.AddHours(-24).ToUnixTimeSeconds();
        var effectiveStep = step is not null ? int.Parse(step) : 60;

        try
        {
            var series = await store.GetGridReadingsAsync(effectiveStart, effectiveEnd, effectiveStep, ct);
            return Results.Ok(new RangeReadingsResponse("grid_power_watts", series));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", "An unexpected error occurred while processing the request"),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }
}
