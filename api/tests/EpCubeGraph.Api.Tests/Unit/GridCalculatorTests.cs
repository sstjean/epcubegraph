using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class GridCalculatorTests
{
    [Fact]
    public void GridPromqlExpression_ContainsGridImportMinusExport()
    {
        // Assert
        // The grid PromQL should compute: grid import - grid export
        // Positive = net import, Negative = net export
        Assert.Equal(
            "epcube_grid_import_kwh - epcube_grid_export_kwh",
            GridCalculator.GridPromqlExpression);
    }

    [Fact]
    public async Task CalculateAsync_UsesDefaultTimeRange_WhenNotProvided()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync();

        // Assert
        Assert.NotNull(mockClient.LastQuery);
        Assert.Equal(GridCalculator.GridPromqlExpression, mockClient.LastQuery);
        Assert.NotNull(mockClient.LastStart);
        Assert.NotNull(mockClient.LastEnd);
        Assert.Equal("1m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_UsesProvidedTimeRange()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync("1000", "2000", "5m");

        // Assert
        Assert.Equal("1000", mockClient.LastStart);
        Assert.Equal("2000", mockClient.LastEnd);
        Assert.Equal("5m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_ReturnsVictoriaMetricsResponse()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        var result = await calculator.CalculateAsync();

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    // Sign convention: positive = net import, negative = net export
    // This is inherent in the PromQL expression (import minus export)
    // When import > export: net consumer from grid (positive)
    // When export > import: net contributor to grid (negative)
    [Fact]
    public void SignConvention_PositiveImport_NegativeExport()
    {
        // Act
        var expr = GridCalculator.GridPromqlExpression;

        // Assert
        Assert.StartsWith("epcube_grid_import", expr);
        Assert.Contains(" - ", expr);
        Assert.Contains("grid_export", expr);
    }

    // ── Edge Cases ──

    [Fact]
    public async Task CalculateAsync_WithOnlyStart_UsesDefaultEndAndStep()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync(start: "1000");

        // Assert
        Assert.Equal("1000", mockClient.LastStart);
        Assert.NotNull(mockClient.LastEnd); // defaulted
        Assert.Equal("1m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_WithOnlyEnd_UsesDefaultStartAndStep()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync(end: "2000");

        // Assert
        Assert.NotNull(mockClient.LastStart); // defaulted
        Assert.Equal("2000", mockClient.LastEnd);
        Assert.Equal("1m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_WithOnlyStep_UsesDefaultStartAndEnd()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync(step: "5m");

        // Assert
        Assert.NotNull(mockClient.LastStart); // defaulted
        Assert.NotNull(mockClient.LastEnd); // defaulted
        Assert.Equal("5m", mockClient.LastStep);
    }

    [Fact]
    public async Task CalculateAsync_DefaultStart_Is24HoursBeforeDefaultEnd()
    {
        // Arrange
        var mockClient = new MockVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act
        await calculator.CalculateAsync();

        // Assert
        var start = long.Parse(mockClient.LastStart!);
        var end = long.Parse(mockClient.LastEnd!);
        var diffHours = (end - start) / 3600.0;

        // Should be approximately 24 hours (within a few seconds of test execution time)
        Assert.InRange(diffHours, 23.99, 24.01);
    }

    [Fact]
    public async Task CalculateAsync_PropagatesHttpRequestException()
    {
        // Arrange
        var mockClient = new ThrowingVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => calculator.CalculateAsync());
    }

    [Fact]
    public async Task CalculateAsync_PropagatesCancellation()
    {
        // Arrange
        var mockClient = new CancellingVictoriaMetricsClient();
        var calculator = new GridCalculator(mockClient);

        // Act & Assert
        await Assert.ThrowsAsync<OperationCanceledException>(
            () => calculator.CalculateAsync(ct: new CancellationToken(true)));
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

    private sealed class ThrowingVictoriaMetricsClient : IVictoriaMetricsClient
    {
        public Task<System.Text.Json.JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default)
            => throw new HttpRequestException("VM unavailable");

        public Task<System.Text.Json.JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default)
            => throw new HttpRequestException("VM unavailable");

        public Task<System.Text.Json.JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default)
            => throw new HttpRequestException("VM unavailable");

        public Task<System.Text.Json.JsonElement> LabelsAsync(CancellationToken ct = default)
            => throw new HttpRequestException("VM unavailable");

        public Task<System.Text.Json.JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default)
            => throw new HttpRequestException("VM unavailable");
    }

    private sealed class CancellingVictoriaMetricsClient : IVictoriaMetricsClient
    {
        public Task<System.Text.Json.JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(default(System.Text.Json.JsonElement));
        }

        public Task<System.Text.Json.JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(default(System.Text.Json.JsonElement));
        }

        public Task<System.Text.Json.JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(default(System.Text.Json.JsonElement));
        }

        public Task<System.Text.Json.JsonElement> LabelsAsync(CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(default(System.Text.Json.JsonElement));
        }

        public Task<System.Text.Json.JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(default(System.Text.Json.JsonElement));
        }
    }
}
