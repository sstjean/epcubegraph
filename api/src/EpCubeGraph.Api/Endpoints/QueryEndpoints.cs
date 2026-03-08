using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class QueryEndpoints
{
    public static RouteGroupBuilder MapQueryEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/query", HandleQuery);
        group.MapGet("/query_range", HandleQueryRange);
        group.MapGet("/series", HandleSeries);
        group.MapGet("/labels", HandleLabels);
        group.MapGet("/label/{name}/values", HandleLabelValues);

        return group;
    }

    private static async Task<IResult> HandleQuery(
        string? query,
        string? time,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        var error = Validate.Required(query, "query");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        error = Validate.Timestamp(time, "time");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var result = await client.QueryAsync(query!, time, ct);
            return Results.Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleQueryRange(
        string? query,
        string? start,
        string? end,
        string? step,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        var error = Validate.Required(query, "query")
            ?? Validate.Required(start, "start")
            ?? Validate.Required(end, "end")
            ?? Validate.Required(step, "step")
            ?? Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end")
            ?? Validate.Duration(step, "step");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var result = await client.QueryRangeAsync(query!, start!, end!, step!, ct);
            return Results.Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleSeries(
        HttpContext httpContext,
        string? start,
        string? end,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        // Prometheus API uses match[] which supports repeated values.
        // ASP.NET Core cannot bind "match[]" as a parameter name, so we read from query directly.
        var matchValues = httpContext.Request.Query["match[]"].ToArray();
        if (matchValues.Length == 0)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", "Parameter 'match[]' is required."));

        var error = Validate.Timestamp(start, "start")
            ?? Validate.Timestamp(end, "end");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            // Use first match value — VictoriaMetrics SeriesAsync accepts a single match string
            var result = await client.SeriesAsync(matchValues[0]!, start, end, ct);
            return Results.Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleLabels(
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        try
        {
            var result = await client.LabelsAsync(ct);
            return Results.Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static async Task<IResult> HandleLabelValues(
        string name,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        var error = Validate.SafeName(name, "name");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        try
        {
            var result = await client.LabelValuesAsync(name, ct);
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
