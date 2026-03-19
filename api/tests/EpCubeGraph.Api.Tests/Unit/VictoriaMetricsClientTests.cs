using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class VictoriaMetricsClientTests
{
    private static VictoriaMetricsClient CreateClient(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://localhost:8428")
        };
        return new VictoriaMetricsClient(httpClient);
    }

    private static HttpMessageHandler CreateMockHandler(HttpStatusCode statusCode, string content)
    {
        return new MockHttpMessageHandler(statusCode, content);
    }

    [Fact]
    public async Task QueryAsync_ReturnsJsonElement_OnSuccess()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"vector","result":[]}}""";
        var handler = CreateMockHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        var result = await client.QueryAsync("up");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    [Fact]
    public async Task QueryAsync_WithTime_IncludesTimeParameter()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"vector","result":[]}}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.QueryAsync("up", time: "1709827200");

        // Assert
        Assert.Contains("time=1709827200", handler.LastRequestUri?.Query);
    }

    [Fact]
    public async Task QueryRangeAsync_ReturnsMatrixResult()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"matrix","result":[]}}""";
        var handler = CreateMockHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        var result = await client.QueryRangeAsync("up", "1709683200", "1709769600", "1m");

        // Assert
        Assert.Equal("matrix", result.GetProperty("data").GetProperty("resultType").GetString());
    }

    [Fact]
    public async Task QueryRangeAsync_IncludesAllParameters()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"matrix","result":[]}}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.QueryRangeAsync("up", "100", "200", "1m");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        Assert.Contains("query=up", query);
        Assert.Contains("start=100", query);
        Assert.Contains("end=200", query);
        Assert.Contains("step=1m", query);
    }

    [Fact]
    public async Task SeriesAsync_ReturnsSeriesData()
    {
        // Arrange
        var json = """{"status":"success","data":[{"__name__":"up","job":"test"}]}""";
        var handler = CreateMockHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        var result = await client.SeriesAsync("up");

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    [Fact]
    public async Task SeriesAsync_WithStart_IncludesStartParameter()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up", start: "1709683200");

        // Assert
        Assert.Contains("start=1709683200", handler.LastRequestUri?.Query);
    }

    [Fact]
    public async Task SeriesAsync_WithEnd_IncludesEndParameter()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up", end: "1709769600");

        // Assert
        Assert.Contains("end=1709769600", handler.LastRequestUri?.Query);
    }

    [Fact]
    public async Task SeriesAsync_WithStartAndEnd_IncludesBothParameters()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up", start: "1000", end: "2000");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        Assert.Contains("start=1000", query);
        Assert.Contains("end=2000", query);
    }

    [Fact]
    public async Task LabelsAsync_ReturnsLabelNames()
    {
        // Arrange
        var json = """{"status":"success","data":["__name__","device"]}""";
        var handler = CreateMockHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        var result = await client.LabelsAsync();

        // Assert
        Assert.Equal("success", result.GetProperty("status").GetString());
    }

    [Fact]
    public async Task LabelValuesAsync_ReturnsValues()
    {
        // Arrange
        var json = """{"status":"success","data":["epcube_battery","epcube_solar"]}""";
        var handler = CreateMockHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        var result = await client.LabelValuesAsync("device");

        // Assert
        Assert.Equal(2, result.GetProperty("data").GetArrayLength());
    }

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On500()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.InternalServerError, "error");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsTaskCanceledException_OnTimeout()
    {
        // Arrange
        var handler = new TimeoutHttpMessageHandler();
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<TaskCanceledException>(() =>
            client.QueryAsync("up", ct: new CancellationToken(true)));
    }

    // ── Edge Cases: Error Status Codes ──

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On400()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.BadRequest, """{"error":"bad request"}""");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On401()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.Unauthorized, "Unauthorized");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On403()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.Forbidden, "Forbidden");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On404()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.NotFound, "Not Found");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsHttpRequestException_On503()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.ServiceUnavailable, "Service Unavailable");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAsync<HttpRequestException>(() => client.QueryAsync("up"));
    }

    // ── Edge Cases: URL Encoding ──

    [Fact]
    public async Task QueryAsync_UrlEncodesSpecialCharacters()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"vector","result":[]}}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.QueryAsync("rate(http_requests_total{job=\"api\"}[5m])");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        // Equals sign and square brackets should be URL-encoded
        Assert.Contains("%3D", query); // = encoded
        Assert.Contains("%5B", query); // [ encoded
        Assert.Contains("%5D", query); // ] encoded
    }

    [Fact]
    public async Task LabelValuesAsync_UrlEncodesLabelName()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.LabelValuesAsync("__name__");

        // Assert
        var path = handler.LastRequestUri?.AbsolutePath ?? "";
        Assert.Contains("__name__", path);
    }

    [Fact]
    public async Task SeriesAsync_UrlEncodesMatchParam()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("{__name__=~\"epcube_.*\"}");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        // The match param should be URL-encoded
        Assert.DoesNotContain("{__name__", query);
    }

    [Fact]
    public async Task QueryRangeAsync_UrlEncodesAllParams()
    {
        // Arrange
        var json = """{"status":"success","data":{"resultType":"matrix","result":[]}}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.QueryRangeAsync("up{job=\"test\"}", "2026-03-07T00:00:00Z", "2026-03-08T00:00:00Z", "1m");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        // Curly braces from PromQL should be encoded
        Assert.DoesNotContain("{", query);
    }

    // ── Edge Cases: SeriesAsync without start ──

    [Fact]
    public async Task SeriesAsync_WithoutStartButWithEnd_OmitsStart()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up", start: null, end: "2000");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        Assert.DoesNotContain("start=", query);
        Assert.Contains("end=2000", query);
    }

    [Fact]
    public async Task SeriesAsync_WithStartButWithoutEnd_OmitsEnd()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up", start: "1000", end: null);

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        Assert.Contains("start=1000", query);
        Assert.DoesNotContain("end=", query);
    }

    [Fact]
    public async Task SeriesAsync_WithoutStartAndEnd_OmitsBoth()
    {
        // Arrange
        var json = """{"status":"success","data":[]}""";
        var handler = new CapturingHttpMessageHandler(HttpStatusCode.OK, json);
        var client = CreateClient(handler);

        // Act
        await client.SeriesAsync("up");

        // Assert
        var query = handler.LastRequestUri?.Query ?? "";
        Assert.DoesNotContain("start=", query);
        Assert.DoesNotContain("end=", query);
    }

    // ── Edge Cases: Empty/Malformed Responses ──

    [Fact]
    public async Task QueryAsync_ThrowsOnEmptyResponse()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.OK, "");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAnyAsync<JsonException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_ThrowsOnMalformedJson()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.OK, "{invalid json");
        var client = CreateClient(handler);

        // Act & Assert
        await Assert.ThrowsAnyAsync<JsonException>(() => client.QueryAsync("up"));
    }

    [Fact]
    public async Task QueryAsync_HandlesMinimalJson()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.OK, "{}");
        var client = CreateClient(handler);

        // Act
        var result = await client.QueryAsync("up");

        // Assert
        Assert.Equal(JsonValueKind.Object, result.ValueKind);
    }

    // ── Mock Handlers ──

    private sealed class MockHttpMessageHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _statusCode;
        private readonly string _content;

        public MockHttpMessageHandler(HttpStatusCode statusCode, string content)
        {
            _statusCode = statusCode;
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(_statusCode)
            {
                Content = new StringContent(_content, System.Text.Encoding.UTF8, "application/json")
            };
            return Task.FromResult(response);
        }
    }

    private sealed class CapturingHttpMessageHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _statusCode;
        private readonly string _content;

        public Uri? LastRequestUri { get; private set; }

        public CapturingHttpMessageHandler(HttpStatusCode statusCode, string content)
        {
            _statusCode = statusCode;
            _content = content;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequestUri = request.RequestUri;
            var response = new HttpResponseMessage(_statusCode)
            {
                Content = new StringContent(_content, System.Text.Encoding.UTF8, "application/json")
            };
            return Task.FromResult(response);
        }
    }

    private sealed class TimeoutHttpMessageHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            throw new TaskCanceledException("Request timed out");
        }
    }
}
