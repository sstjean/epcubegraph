using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Tests for all API endpoint handlers with authentication bypassed
/// and a mock VictoriaMetrics client injected.
/// Covers: QueryEndpoints, DevicesEndpoints, GridEndpoints, HealthEndpoints,
///         model record construction (ErrorResponse, DeviceListResponse, etc.),
///         and Program.cs middleware pipeline.
/// </summary>
public class EndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public EndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        // Reset all mock state before each test
        _factory.MockClient.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    // ── Health ──

    [Fact]
    public async Task Health_ReturnsHealthy_WhenVmReachable()
    {
        var response = await _client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("healthy", body);
        Assert.Contains("reachable", body);
    }

    [Fact]
    public async Task Health_ReturnsUnhealthy_WhenVmUnreachable()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("unhealthy", body);
        Assert.Contains("unreachable", body);
    }

    // ── Query ──

    [Fact]
    public async Task Query_ReturnsOk_WithValidQuery()
    {
        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        Assert.Equal("success", body.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Query_ReturnsOk_WithQueryAndTime()
    {
        var response = await _client.GetAsync("/api/v1/query?query=up&time=1709827200");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryMissing()
    {
        var response = await _client.GetAsync("/api/v1/query");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'query' is required", body);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenTimeInvalid()
    {
        var response = await _client.GetAsync("/api/v1/query?query=up&time=not-a-time");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'time'", body);
    }

    [Fact]
    public async Task Query_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("error", body);
    }

    // ── Query Range ──

    [Fact]
    public async Task QueryRange_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenQueryMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenEndMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepMissing()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=not-a-time&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenEndInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=not-a-time&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Series ──

    [Fact]
    public async Task Series_ReturnsOk_WithMatchParam()
    {
        var response = await _client.GetAsync("/api/v1/series?match[]=up");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithStartAndEnd()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=1000&end=2000");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenMatchMissing()
    {
        var response = await _client.GetAsync("/api/v1/series");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("match[]", body);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenStartInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=not-a-time");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenEndInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&end=not-a-time");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Series_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/series?match[]=up");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Labels ──

    [Fact]
    public async Task Labels_ReturnsOk()
    {
        var response = await _client.GetAsync("/api/v1/labels");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Labels_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/labels");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Label Values ──

    [Fact]
    public async Task LabelValues_ReturnsOk()
    {
        var response = await _client.GetAsync("/api/v1/label/device/values");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameInvalid()
    {
        var response = await _client.GetAsync("/api/v1/label/some-bad-name!/values");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/label/device/values");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Devices ──

    [Fact]
    public async Task Devices_ReturnsOk_WithEmptyList()
    {
        // Default mock returns empty series data
        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceData()
    {
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery",
                        "manufacturer": "Canadian Solar",
                        "product_code": "EP Cube 2.0",
                        "uid": "ABC123"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": [
                        {
                            "metric": {"device": "epcube_battery"},
                            "value": [1709827200, "1"]
                        }
                    ]
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("storage_battery", body);
        Assert.Contains("Canadian Solar", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceMissingOptionalFields()
    {
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_solar",
                        "class": "home_solar"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": []
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_solar", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_ScrapeSuccessOffline()
    {
        // Device with scrape_success = 0 should be offline
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": [
                        {
                            "metric": {"device": "epcube_battery"},
                            "value": [1709827200, "0"]
                        }
                    ]
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Device Metrics ──

    [Fact]
    public async Task DeviceMetrics_ReturnsOk_WithMetrics()
    {
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"__name__": "echonet_battery_soc"},
                    {"__name__": "echonet_battery_power"},
                    {"__name__": "echonet_battery_soc"}
                ]
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("echonet_battery_soc", body);
        Assert.Contains("echonet_battery_power", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenNoMetrics()
    {
        // Default mock returns empty data array
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("not_found", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceInvalid()
    {
        var response = await _client.GetAsync("/api/v1/devices/bad-device!/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_HandlesSeriesWithoutName()
    {
        // Series entry without __name__ should be skipped
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"device": "epcube_battery"},
                    {"__name__": "echonet_battery_soc"}
                ]
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("echonet_battery_soc", body);
    }

    // ── Grid ──

    [Fact]
    public async Task Grid_ReturnsOk_WithValidParams()
    {
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithDefaults()
    {
        // All params optional — GridCalculator uses defaults
        var response = await _client.GetAsync("/api/v1/grid");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/grid?start=not-a-time&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenEndInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=not-a-time&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepInvalid()
    {
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_Returns422_WhenVmFails()
    {
        _factory.MockClient.ShouldThrow = true;

        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Edge Cases: Query ──

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryIsEmptyString()
    {
        // query= (empty value) should trigger Required validation
        var response = await _client.GetAsync("/api/v1/query?query=");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'query' is required", body);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryIsWhitespace()
    {
        var response = await _client.GetAsync("/api/v1/query?query=%20%20%20");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsOk_WithRfc3339Time()
    {
        var response = await _client.GetAsync(
            "/api/v1/query?query=up&time=2026-03-07T00:00:00Z");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsOk_WithSpecialCharactersInQuery()
    {
        // PromQL with curly braces and quotes
        var response = await _client.GetAsync(
            "/api/v1/query?query=rate(http_requests_total%7Bjob%3D%22api%22%7D%5B5m%5D)");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: QueryRange ──

    [Fact]
    public async Task QueryRange_ReturnsOk_WithRfc3339Timestamps()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z&step=5m");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenQueryIsEmptyString()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=&start=1000&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartIsEmptyString()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=&end=2000&step=1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepIsNegative()
    {
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=-1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Edge Cases: Series ──

    [Fact]
    public async Task Series_ReturnsOk_WithMultipleMatchValues()
    {
        // Only the first match[] value is used per the endpoint implementation
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&match[]=down");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithOnlyStart()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=1000");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithOnlyEnd()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&end=2000");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithRfc3339Timestamps()
    {
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: Label Values ──

    [Fact]
    public async Task LabelValues_ReturnsOk_WithUnderscorePrefixedName()
    {
        var response = await _client.GetAsync("/api/v1/label/__name__/values");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameStartsWithNumber()
    {
        var response = await _client.GetAsync("/api/v1/label/123name/values");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameHasDots()
    {
        var response = await _client.GetAsync("/api/v1/label/some.label/values");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Edge Cases: Devices ──

    [Fact]
    public async Task Devices_ReturnsOk_WithMultipleDevices_MixedOnlineStatus()
    {
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery"
                    },
                    {
                        "device": "epcube_solar",
                        "class": "home_solar",
                        "manufacturer": "Canadian Solar"
                    },
                    {
                        "device": "epcube_meter",
                        "class": "smart_meter",
                        "uid": "METER001"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": [
                        {
                            "metric": {"device": "epcube_battery"},
                            "value": [1709827200, "1"]
                        },
                        {
                            "metric": {"device": "epcube_solar"},
                            "value": [1709827200, "0"]
                        }
                    ]
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // Battery is online (value=1), solar is offline (value=0), meter has no scrape entry
        Assert.Contains("epcube_battery", body);
        Assert.Contains("epcube_solar", body);
        Assert.Contains("epcube_meter", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenScrapeResultMissingMetricProperty()
    {
        // Scrape results where items don't have the expected "metric" property
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": [
                        {
                            "value": [1709827200, "1"]
                        }
                    ]
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        // Should not crash; device just won't be in onlineDevices set
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenScrapeResultMissingDeviceInMetric()
    {
        // Scrape result has "metric" but no "device" within it
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success",
                "data": {
                    "resultType": "vector",
                    "result": [
                        {
                            "metric": {"job": "echonet"},
                            "value": [1709827200, "1"]
                        }
                    ]
                }
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenScrapeDataPropertyMissing()
    {
        // Query response doesn't have "data" at top level
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {
                        "device": "epcube_battery",
                        "class": "storage_battery"
                    }
                ]
            }
            """;

        _factory.MockClient.QueryResponse = """
            {
                "status": "success"
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        // No scrape data → all devices offline
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenInfoDataPropertyMissing()
    {
        // Series response doesn't have "data" at top level
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success"
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices");

        // No device info → empty list
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    // ── Edge Cases: Device Metrics ──

    [Fact]
    public async Task DeviceMetrics_DeduplicatesMetricNames()
    {
        // All three entries have the same metric name → should only appear once
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"__name__": "echonet_battery_soc"},
                    {"__name__": "echonet_battery_soc"},
                    {"__name__": "echonet_battery_soc"}
                ]
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var metrics = doc.RootElement.GetProperty("metrics");
        Assert.Equal(1, metrics.GetArrayLength());
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceIsSqlInjection()
    {
        var response = await _client.GetAsync(
            "/api/v1/devices/'; DROP TABLE users; --/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceHasDots()
    {
        var response = await _client.GetAsync("/api/v1/devices/device.name/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenAllSeriesLackName()
    {
        // All series entries lack __name__ → metrics list empty → 404
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"device": "epcube_battery"},
                    {"device": "epcube_battery", "class": "storage_battery"}
                ]
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenDataPropertyMissing()
    {
        // Series response has no "data" property → empty metrics → 404
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success"
            }
            """;

        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── Edge Cases: Grid ──

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyStart()
    {
        var response = await _client.GetAsync("/api/v1/grid?start=1000");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyEnd()
    {
        var response = await _client.GetAsync("/api/v1/grid?end=2000");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyStep()
    {
        var response = await _client.GetAsync("/api/v1/grid?step=5m");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithRfc3339Timestamps()
    {
        var response = await _client.GetAsync(
            "/api/v1/grid?start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z&step=1h");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepIsNegative()
    {
        var response = await _client.GetAsync("/api/v1/grid?step=-1m");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Edge Cases: Auth ──

    [Fact]
    public async Task Health_DoesNotRequireAuth()
    {
        // Health endpoint is explicitly AllowAnonymous
        var response = await _client.GetAsync("/api/v1/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: Response Content-Type ──

    [Fact]
    public async Task Query_ReturnsJsonContentType()
    {
        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("application/json", response.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task Health_ReturnsJsonContentType()
    {
        var response = await _client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("application/json", response.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task ErrorResponse_Returns422WithJsonContentType()
    {
        _factory.MockClient.ShouldThrow = true;
        _factory.MockClient.ThrowMessage = "Connection refused";

        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Connection refused", body);
    }
}
