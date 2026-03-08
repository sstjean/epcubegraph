using System.Text.Json;

namespace EpCubeGraph.Api.Services;

public sealed class GridCalculator
{
    public const string GridPromqlExpression =
        "echonet_solar_instantaneous_generation_watts - echonet_battery_charge_discharge_power_watts";

    private readonly IVictoriaMetricsClient _client;

    public GridCalculator(IVictoriaMetricsClient client)
    {
        _client = client;
    }

    public async Task<JsonElement> CalculateAsync(
        string? start = null,
        string? end = null,
        string? step = null,
        CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var effectiveEnd = end ?? now.ToUnixTimeSeconds().ToString();
        var effectiveStart = start ?? now.AddHours(-24).ToUnixTimeSeconds().ToString();
        var effectiveStep = step ?? "1m";

        return await _client.QueryRangeAsync(
            GridPromqlExpression,
            effectiveStart,
            effectiveEnd,
            effectiveStep,
            ct);
    }
}
