using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class GridEndpoints
{
    public const string GridPromqlExpression =
        "epcube_grid_import_kwh - epcube_grid_export_kwh";

    public static RouteGroupBuilder MapGridEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/grid", HandleGrid);

        return group;
    }

    private static async Task<IResult> HandleGrid(
        string? start,
        string? end,
        string? step,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        var error = Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end")
            ?? Validate.Duration(step, "step");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        var now = DateTimeOffset.UtcNow;
        var effectiveEnd = end ?? now.ToUnixTimeSeconds().ToString();
        var effectiveStart = start ?? now.AddHours(-24).ToUnixTimeSeconds().ToString();
        var effectiveStep = step ?? "1m";

        try
        {
            var result = await client.QueryRangeAsync(
                GridPromqlExpression,
                effectiveStart,
                effectiveEnd,
                effectiveStep,
                ct);
            return Results.Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }
}
