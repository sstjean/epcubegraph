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
        GridCalculator calculator,
        CancellationToken ct)
    {
        var error = Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end")
            ?? Validate.Duration(step, "step");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var result = await calculator.CalculateAsync(start, end, step, ct);
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
