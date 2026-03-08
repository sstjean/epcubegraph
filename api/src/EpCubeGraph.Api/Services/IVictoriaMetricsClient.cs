using System.Text.Json;

namespace EpCubeGraph.Api.Services;

public interface IVictoriaMetricsClient
{
    Task<JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default);

    Task<JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default);

    Task<JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default);

    Task<JsonElement> LabelsAsync(CancellationToken ct = default);

    Task<JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default);
}
