using System.Text.Json;

namespace EpCubeGraph.Api.Services;

public sealed class VictoriaMetricsClient : IVictoriaMetricsClient
{
    private readonly HttpClient _http;

    public VictoriaMetricsClient(HttpClient httpClient)
    {
        _http = httpClient;
    }

    public async Task<JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default)
    {
        var url = $"/api/v1/query?query={Uri.EscapeDataString(query)}";
        if (time is not null)
        {
            url += $"&time={Uri.EscapeDataString(time)}";
        }

        return await GetJsonAsync(url, ct);
    }

    public async Task<JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default)
    {
        var url = $"/api/v1/query_range?query={Uri.EscapeDataString(query)}&start={Uri.EscapeDataString(start)}&end={Uri.EscapeDataString(end)}&step={Uri.EscapeDataString(step)}";
        return await GetJsonAsync(url, ct);
    }

    public async Task<JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default)
    {
        var url = $"/api/v1/series?match[]={Uri.EscapeDataString(match)}";
        if (start is not null)
        {
            url += $"&start={Uri.EscapeDataString(start)}";
        }

        if (end is not null)
        {
            url += $"&end={Uri.EscapeDataString(end)}";
        }

        return await GetJsonAsync(url, ct);
    }

    public async Task<JsonElement> LabelsAsync(CancellationToken ct = default)
    {
        return await GetJsonAsync("/api/v1/labels", ct);
    }

    public async Task<JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default)
    {
        return await GetJsonAsync($"/api/v1/label/{Uri.EscapeDataString(labelName)}/values", ct);
    }

    private async Task<JsonElement> GetJsonAsync(string url, CancellationToken ct)
    {
        var response = await _http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();
        var stream = await response.Content.ReadAsStreamAsync(ct);
        var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        return doc.RootElement.Clone();
    }
}
