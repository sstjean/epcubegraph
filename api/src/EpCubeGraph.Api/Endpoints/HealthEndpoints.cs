using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class HealthEndpoints
{
    public static RouteGroupBuilder MapHealthEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/health", HandleHealth)
            .AllowAnonymous()
            .Produces<HealthResponse>()
            .Produces<HealthResponse>(StatusCodes.Status503ServiceUnavailable);

        return group;
    }

    private static async Task<IResult> HandleHealth(IVictoriaMetricsClient client)
    {
        try
        {
            await client.QueryAsync("up");
            return Results.Ok(new HealthResponse("healthy", "reachable"));
        }
        catch
        {
            return Results.Json(
                new HealthResponse("unhealthy", "unreachable"),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
