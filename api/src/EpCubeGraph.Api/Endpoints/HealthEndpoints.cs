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

    private static async Task<IResult> HandleHealth(IVictoriaMetricsClient client, CancellationToken ct)
    {
        try
        {
            await client.LabelsAsync(ct);
            return Results.Ok(new HealthResponse("healthy", "ok"));
        }
        catch
        {
            return Results.Json(
                new HealthResponse("unhealthy", "unreachable"),
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
