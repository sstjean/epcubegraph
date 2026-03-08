using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class VictoriaMetricsIntegrationTests : IClassFixture<VictoriaMetricsFixture>
{
    private readonly VictoriaMetricsFixture _fixture;
    private readonly VictoriaMetricsClient _client;

    public VictoriaMetricsIntegrationTests(VictoriaMetricsFixture fixture)
    {
        _fixture = fixture;
        var httpClient = new HttpClient { BaseAddress = new Uri(fixture.BaseUrl) };
        _client = new VictoriaMetricsClient(httpClient);
    }

    [Fact]
    public async Task QueryRangeAsync_ReturnsCorrectTimeSeries_AfterInsertingData()
    {
        // Insert test data via Prometheus import API
        var now = DateTimeOffset.UtcNow;
        var timestamp = now.ToUnixTimeMilliseconds();
        var lines = new StringBuilder();
        lines.AppendLine($"test_metric{{device=\"battery\"}} 42 {timestamp}");

        await ImportPrometheusData(lines.ToString());

        // Wait for data to be indexed
        await Task.Delay(1000);

        // Query the data
        var start = now.AddMinutes(-5).ToUnixTimeSeconds().ToString();
        var end = now.AddMinutes(5).ToUnixTimeSeconds().ToString();
        var result = await _client.QueryRangeAsync(
            "test_metric{device=\"battery\"}",
            start,
            end,
            "1m");

        Assert.Equal("success", result.GetProperty("status").GetString());
        var data = result.GetProperty("data");
        Assert.Equal("matrix", data.GetProperty("resultType").GetString());
    }

    [Fact]
    public async Task QueryRangeAsync_EmptyRange_ReturnsEmptyResult()
    {
        // Query a metric that doesn't exist
        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5).ToUnixTimeSeconds().ToString();
        var end = now.AddMinutes(5).ToUnixTimeSeconds().ToString();
        var result = await _client.QueryRangeAsync(
            "nonexistent_metric_abc{device=\"nothing\"}",
            start,
            end,
            "1m");

        Assert.Equal("success", result.GetProperty("status").GetString());
        var data = result.GetProperty("data");
        Assert.Equal("matrix", data.GetProperty("resultType").GetString());
        Assert.Equal(0, data.GetProperty("result").GetArrayLength());
    }

    [Fact]
    public async Task QueryAsync_ReturnsInstantVector_AfterInsertingData()
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"integration_test_instant{{job=\"test\"}} 99 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        var result = await _client.QueryAsync("integration_test_instant{job=\"test\"}");

        Assert.Equal("success", result.GetProperty("status").GetString());
        Assert.Equal("vector", result.GetProperty("data").GetProperty("resultType").GetString());
    }

    [Fact]
    public async Task SeriesAsync_ReturnsMatchingSeries()
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"series_test_metric{{env=\"prod\"}} 1 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        var result = await _client.SeriesAsync("series_test_metric");

        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    [Fact]
    public async Task LabelsAsync_ReturnsLabelNames()
    {
        var result = await _client.LabelsAsync();

        Assert.Equal("success", result.GetProperty("status").GetString());
        Assert.True(result.GetProperty("data").GetArrayLength() >= 0);
    }

    [Fact]
    public async Task LabelValuesAsync_ReturnsValues()
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"label_test_metric{{color=\"blue\"}} 1 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        var result = await _client.LabelValuesAsync("color");

        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    private async Task ImportPrometheusData(string prometheusLines)
    {
        using var httpClient = new HttpClient { BaseAddress = new Uri(_fixture.BaseUrl) };
        var content = new StringContent(prometheusLines, Encoding.UTF8, "text/plain");
        var response = await httpClient.PostAsync("/api/v1/import/prometheus", content);
        response.EnsureSuccessStatusCode();
    }
}
