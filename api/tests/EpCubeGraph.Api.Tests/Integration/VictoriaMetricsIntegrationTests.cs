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
        // Arrange
        var now = DateTimeOffset.UtcNow;
        var timestamp = now.ToUnixTimeMilliseconds();
        var lines = new StringBuilder();
        lines.AppendLine($"test_metric{{device=\"battery\"}} 42 {timestamp}");
        await ImportPrometheusData(lines.ToString());
        await Task.Delay(1000);
        var start = now.AddMinutes(-5).ToUnixTimeSeconds().ToString();
        var end = now.AddMinutes(5).ToUnixTimeSeconds().ToString();

        // Act
        var result = await _client.QueryRangeAsync(
            "test_metric{device=\"battery\"}",
            start,
            end,
            "1m");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
        var data = result.GetProperty("data");
        Assert.Equal("matrix", data.GetProperty("resultType").GetString());
    }

    [Fact]
    public async Task QueryRangeAsync_EmptyRange_ReturnsEmptyResult()
    {
        // Arrange
        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-5).ToUnixTimeSeconds().ToString();
        var end = now.AddMinutes(5).ToUnixTimeSeconds().ToString();

        // Act
        var result = await _client.QueryRangeAsync(
            "nonexistent_metric_abc{device=\"nothing\"}",
            start,
            end,
            "1m");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
        var data = result.GetProperty("data");
        Assert.Equal("matrix", data.GetProperty("resultType").GetString());
        Assert.Equal(0, data.GetProperty("result").GetArrayLength());
    }

    [Fact]
    public async Task QueryAsync_ReturnsInstantVector_AfterInsertingData()
    {
        // Arrange
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"integration_test_instant{{job=\"test\"}} 99 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        // Act
        var result = await _client.QueryAsync("integration_test_instant{job=\"test\"}");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
        Assert.Equal("vector", result.GetProperty("data").GetProperty("resultType").GetString());
    }

    [Fact]
    public async Task SeriesAsync_ReturnsMatchingSeries()
    {
        // Arrange
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"series_test_metric{{env=\"prod\"}} 1 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        // Act
        var result = await _client.SeriesAsync("series_test_metric");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    [Fact]
    public async Task LabelsAsync_ReturnsLabelNames()
    {
        // Act
        var result = await _client.LabelsAsync();

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
        Assert.True(result.GetProperty("data").GetArrayLength() >= 0);
    }

    [Fact]
    public async Task LabelValuesAsync_ReturnsValues()
    {
        // Arrange
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = $"label_test_metric{{color=\"blue\"}} 1 {timestamp}";
        await ImportPrometheusData(lines);
        await Task.Delay(1000);

        // Act
        var result = await _client.LabelValuesAsync("color");

        // Assert
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
