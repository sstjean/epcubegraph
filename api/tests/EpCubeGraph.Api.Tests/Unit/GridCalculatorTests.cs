using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class GridCalculatorTests
{
    [Fact]
    public void GridPromqlExpression_ContainsSolarMinusBattery()
    {
        // The grid PromQL should compute: solar generation - battery charge/discharge
        // Positive = export, Negative = import
        Assert.Equal(
            "echonet_solar_instantaneous_generation_watts - echonet_battery_charge_discharge_power_watts",
            GridCalculator.GridPromqlExpression);
    }

    [Fact]
    public async Task CalculateAsync_UsesDefaultTimeRange_WhenNotProvided()
    {
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        await calculator.CalculateAsync();

        Assert.NotNull(mockClient.LastQuery);
        Assert.Equal(GridCalculator.GridPromqlExpression, mockClient.LastQuery);
        Assert.NotNull(mockClient.LastStart);
        Assert.NotNull(mockClient.LastEnd);
        Assert.Equal("1m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_UsesProvidedTimeRange()
    {
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        await calculator.CalculateAsync("1000", "2000", "5m");

        Assert.Equal("1000", mockClient.LastStart);
        Assert.Equal("2000", mockClient.LastEnd);
        Assert.Equal("5m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_ReturnsVictoriaMetricsResponse()
    {
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        var result = await calculator.CalculateAsync();

        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    // Sign convention: positive = export, negative = import
    // This is inherent in the PromQL expression (solar minus battery)
    // When solar > battery_charge: excess goes to grid (positive/export)
    // When solar < battery_charge: deficit comes from grid (negative/import)
    [Fact]
    public void SignConvention_PositiveExport_NegativeImport()
    {
        // solar = 1000W, battery_charge = 600W → grid = 400W (export)
        // solar = 200W, battery_charge = 800W → grid = -600W (import)
        // This is documented in the PromQL: solar - battery
        var expr = GridCalculator.GridPromqlExpression;
        Assert.StartsWith("echonet_solar", expr);
        Assert.Contains(" - ", expr);
        Assert.Contains("battery_charge_discharge", expr);
    }

    private sealed class MockVictoriaMetricsClient : IVictoriaMetricsClient
    {
        public string? LastQuery { get; private set; }
        public string? LastStart { get; private set; }
        public string? LastEnd { get; private set; }
        public string? LastStep { get; private set; }

        public Task<System.Text.Json.JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default)
        {
            LastQuery = query;
            return Task.FromResult(CreateSuccessResponse());
        }

        public Task<System.Text.Json.JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default)
        {
            LastQuery = query;
            LastStart = start;
            LastEnd = end;
            LastStep = step;
            return Task.FromResult(CreateSuccessResponse());
        }

        public Task<System.Text.Json.JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default)
            => Task.FromResult(CreateSuccessResponse());

        public Task<System.Text.Json.JsonElement> LabelsAsync(CancellationToken ct = default)
            => Task.FromResult(CreateSuccessResponse());

        public Task<System.Text.Json.JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default)
            => Task.FromResult(CreateSuccessResponse());

        private static System.Text.Json.JsonElement CreateSuccessResponse()
        {
            var json = """{"status":"success","data":{"resultType":"matrix","result":[]}}""";
            return System.Text.Json.JsonDocument.Parse(json).RootElement.Clone();
        }
    }
}
