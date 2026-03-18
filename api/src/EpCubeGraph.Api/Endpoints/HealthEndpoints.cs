using EpCubeGraph.Api.Models;

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

    private static IResult HandleHealth()
    {
        return Results.Ok(new HealthResponse("healthy", "ok"));
    }
}
