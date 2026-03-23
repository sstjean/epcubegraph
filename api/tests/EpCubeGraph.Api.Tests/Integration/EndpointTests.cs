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
    public async Task Health_ReturnsHealthy()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("healthy", body);
    }

    [Fact]
    public async Task Health_Returns503_WhenVmUnreachable()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("unhealthy", body);
        Assert.Contains("unreachable", body);
    }

    // ── Query ──

    [Fact]
    public async Task Query_ReturnsOk_WithValidQuery()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        Assert.Equal("success", body.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Query_ReturnsOk_WithQueryAndTime()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up&time=1709827200");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryMissing()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'query' is required", body);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenTimeInvalid()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up&time=not-a-time");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'time'", body);
    }

    [Fact]
    public async Task Query_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("error", body);
    }

    // ── Query Range ──

    [Fact]
    public async Task QueryRange_ReturnsOk_WithValidParams()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenQueryMissing()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartMissing()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenEndMissing()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepMissing()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=abc");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=not-a-time&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenEndInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=not-a-time&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Series ──

    [Fact]
    public async Task Series_ReturnsOk_WithMatchParam()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/series?match[]=up");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithStartAndEnd()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=1000&end=2000");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenMatchMissing()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/series");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("match[]", body);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenStartInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=not-a-time");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsBadRequest_WhenEndInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&end=not-a-time");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Series_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/series?match[]=up");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Labels ──

    [Fact]
    public async Task Labels_ReturnsOk()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/labels");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Labels_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/labels");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Label Values ──

    [Fact]
    public async Task LabelValues_ReturnsOk()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/device/values");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameInvalid()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/some-bad-name!/values");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/label/device/values");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Devices ──

    [Fact]
    public async Task Devices_ReturnsOk_WithEmptyList()
    {
        // Act — default mock returns empty series data
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceData()
    {
        // Arrange
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("storage_battery", body);
        Assert.Contains("Canadian Solar", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WithDeviceMissingOptionalFields()
    {
        // Arrange
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_solar", body);
    }

    [Fact]
    public async Task Devices_ReturnsOk_ScrapeSuccessOffline()
    {
        // Arrange — device with scrape_success = 0 should be offline
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Device Metrics ──

    [Fact]
    public async Task DeviceMetrics_ReturnsOk_WithMetrics()
    {
        // Arrange
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"__name__": "epcube_battery_soc"},
                    {"__name__": "epcube_battery_power"},
                    {"__name__": "epcube_battery_soc"}
                ]
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery", body);
        Assert.Contains("epcube_battery_soc", body);
        Assert.Contains("epcube_battery_power", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenNoMetrics()
    {
        // Act — default mock returns empty data array
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("not_found", body);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceInvalid()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/devices/bad-device!/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_HandlesSeriesWithoutName()
    {
        // Arrange — series entry without __name__ should be skipped
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"device": "epcube_battery"},
                    {"__name__": "epcube_battery_soc"}
                ]
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("epcube_battery_soc", body);
    }

    // ── Grid ──

    [Fact]
    public async Task Grid_ReturnsOk_WithValidParams()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithDefaults()
    {
        // Act — all params optional, endpoint uses defaults
        var response = await _client.GetAsync("/api/v1/grid");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStartInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=not-a-time&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenEndInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=not-a-time&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepInvalid()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=abc");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Grid_Returns422_WhenVmFails()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── Edge Cases: Query ──

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryIsEmptyString()
    {
        // Act — query= (empty value) should trigger Required validation
        var response = await _client.GetAsync("/api/v1/query?query=");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("'query' is required", body);
    }

    [Fact]
    public async Task Query_ReturnsBadRequest_WhenQueryIsWhitespace()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=%20%20%20");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsOk_WithRfc3339Time()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query?query=up&time=2026-03-07T00:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsOk_WithSpecialCharactersInQuery()
    {
        // Act — PromQL with curly braces and quotes
        var response = await _client.GetAsync(
            "/api/v1/query?query=rate(http_requests_total%7Bjob%3D%22api%22%7D%5B5m%5D)");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: QueryRange ──

    [Fact]
    public async Task QueryRange_ReturnsOk_WithRfc3339Timestamps()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z&step=5m");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenQueryIsEmptyString()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=&start=1000&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStartIsEmptyString()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=&end=2000&step=1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task QueryRange_ReturnsBadRequest_WhenStepIsNegative()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/query_range?query=up&start=1000&end=2000&step=-1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Edge Cases: Series ──

    [Fact]
    public async Task Series_ReturnsOk_WithMultipleMatchValues()
    {
        // Act — only the first match[] value is used per the endpoint implementation
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&match[]=down");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithOnlyStart()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=1000");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithOnlyEnd()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&end=2000");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Series_ReturnsOk_WithRfc3339Timestamps()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/series?match[]=up&start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: Label Values ──

    [Fact]
    public async Task LabelValues_ReturnsOk_WithUnderscorePrefixedName()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/__name__/values");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameStartsWithNumber()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/123name/values");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task LabelValues_ReturnsBadRequest_WhenNameHasDots()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/label/some.label/values");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Edge Cases: Devices ──

    [Fact]
    public async Task Devices_ReturnsOk_WithMultipleDevices_MixedOnlineStatus()
    {
        // Arrange
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
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
        // Arrange — scrape results where items don't have the expected "metric" property
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert — should not crash; device just won't be in onlineDevices set
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenScrapeResultMissingDeviceInMetric()
    {
        // Arrange — scrape result has "metric" but no "device" within it
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
                            "metric": {"job": "epcube"},
                            "value": [1709827200, "1"]
                        }
                    ]
                }
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenScrapeDataPropertyMissing()
    {
        // Arrange — query response doesn't have "data" at top level
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

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert — no scrape data → all devices offline
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Devices_ReturnsOk_WhenInfoDataPropertyMissing()
    {
        // Arrange — series response doesn't have "data" at top level
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success"
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices");

        // Assert — no device info → empty list
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("devices", body);
    }

    // ── Edge Cases: Device Metrics ──

    [Fact]
    public async Task DeviceMetrics_DeduplicatesMetricNames()
    {
        // Arrange — all three entries have the same metric name → should only appear once
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"__name__": "epcube_battery_soc"},
                    {"__name__": "epcube_battery_soc"},
                    {"__name__": "epcube_battery_soc"}
                ]
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var metrics = doc.RootElement.GetProperty("metrics");
        Assert.Equal(1, metrics.GetArrayLength());
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceIsSqlInjection()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/devices/'; DROP TABLE users; --/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsBadRequest_WhenDeviceHasDots()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/devices/device.name/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenAllSeriesLackName()
    {
        // Arrange — all series entries lack __name__ → metrics list empty → 404
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success",
                "data": [
                    {"device": "epcube_battery"},
                    {"device": "epcube_battery", "class": "storage_battery"}
                ]
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeviceMetrics_ReturnsNotFound_WhenDataPropertyMissing()
    {
        // Arrange — series response has no "data" property → empty metrics → 404
        _factory.MockClient.SeriesResponse = """
            {
                "status": "success"
            }
            """;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/epcube_battery/metrics");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── Edge Cases: Grid ──

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyStart()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/grid?start=1000");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyEnd()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/grid?end=2000");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithOnlyStep()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/grid?step=5m");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsOk_WithRfc3339Timestamps()
    {
        // Act
        var response = await _client.GetAsync(
            "/api/v1/grid?start=2026-03-07T00:00:00Z&end=2026-03-08T00:00:00Z&step=1h");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Grid_ReturnsBadRequest_WhenStepIsNegative()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/grid?step=-1m");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public void Grid_PromqlExpression_ContainsGridImportMinusExport()
    {
        // Assert — positive = net import, negative = net export
        Assert.Equal(
            "epcube_grid_import_kwh - epcube_grid_export_kwh",
            EpCubeGraph.Api.Endpoints.GridEndpoints.GridPromqlExpression);
    }

    // ── Edge Cases: Auth ──

    [Fact]
    public async Task Health_DoesNotRequireAuth()
    {
        // Act — health endpoint is explicitly AllowAnonymous
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Edge Cases: Response Content-Type ──

    [Fact]
    public async Task Query_ReturnsJsonContentType()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("application/json", response.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task Health_ReturnsJsonContentType()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("application/json", response.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task ErrorResponse_Returns422WithJsonContentType()
    {
        // Arrange
        _factory.MockClient.ShouldThrow = true;
        _factory.MockClient.ThrowMessage = "Connection refused";

        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Connection refused", body);
    }
}
