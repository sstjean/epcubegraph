using System.Diagnostics;
using System.Text;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class PerformanceTests : IClassFixture<VictoriaMetricsFixture>
{
    private readonly VictoriaMetricsFixture _fixture;
    private readonly VictoriaMetricsClient _client;

    public PerformanceTests(VictoriaMetricsFixture fixture)
    {
        _fixture = fixture;
        var httpClient = new HttpClient { BaseAddress = new Uri(fixture.BaseUrl) };
        _client = new VictoriaMetricsClient(httpClient);
    }

    [Fact]
    public async Task QueryRange_30DaysData_CompletesWithin2Seconds()
    {
        // Arrange
        // SC-003: Seed 30 days of synthetic data, assert query returns within 2s
        var now = DateTimeOffset.UtcNow;
        var startTime = now.AddDays(-30);
        var batchSize = 1000;
        var totalSamples = 30 * 24 * 60; // 43200 samples (1 per minute for 30 days)

        for (var i = 0; i < totalSamples; i += batchSize)
        {
            var lines = new StringBuilder();
            var count = Math.Min(batchSize, totalSamples - i);

            for (var j = 0; j < count; j++)
            {
                var sampleTime = startTime.AddMinutes(i + j);
                var timestampMs = sampleTime.ToUnixTimeMilliseconds();
                var value = 500 + (300 * Math.Sin((i + j) * Math.PI / 720)); // Sinusoidal pattern
                lines.AppendLine($"perf_test_solar_watts{{device=\"solar\"}} {value:F1} {timestampMs}");
            }

            await ImportPrometheusData(lines.ToString());
        }

        await Task.Delay(2000);
        var queryStart = now.AddDays(-30).ToUnixTimeSeconds().ToString();
        var queryEnd = now.ToUnixTimeSeconds().ToString();

        // Act
        var sw = Stopwatch.StartNew();
        var result = await _client.QueryRangeAsync(
            "perf_test_solar_watts{device=\"solar\"}",
            queryStart,
            queryEnd,
            "1m");
        sw.Stop();

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
        Assert.True(sw.Elapsed.TotalSeconds < 2.0,
            $"Query took {sw.Elapsed.TotalSeconds:F2}s, expected < 2.0s (SC-003)");
    }

    private async Task ImportPrometheusData(string prometheusLines)
    {
        using var httpClient = new HttpClient { BaseAddress = new Uri(_fixture.BaseUrl) };
        var content = new StringContent(prometheusLines, Encoding.UTF8, "text/plain");
        var response = await httpClient.PostAsync("/api/v1/import/prometheus", content);
        response.EnsureSuccessStatusCode();
    }
}
