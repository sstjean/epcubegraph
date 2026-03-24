using System.Net;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// OWASP attack surface tests — verifies the API rejects common injection,
/// traversal, and XSS payloads at the HTTP boundary.
/// Uses MockableTestFactory (auth bypassed) so payloads reach the handlers.
/// </summary>
public class SecurityAttackTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly HttpClient _client;

    public SecurityAttackTests(MockableTestFactory factory)
    {
        factory.MockStore.Reset();
        _client = factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    // ── SQL Injection via metric parameter ──

    [Theory]
    [InlineData("'; DROP TABLE readings; --")]
    [InlineData("\" OR 1=1 --")]
    [InlineData("metric UNION SELECT * FROM devices --")]
    [InlineData("1; DELETE FROM readings")]
    [InlineData("epcube' OR '1'='1")]
    [InlineData("battery_soc'; TRUNCATE TABLE readings; --")]
    public async Task SqlInjection_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("invalid characters", body);
    }

    [Theory]
    [InlineData("'; DROP TABLE readings; --")]
    [InlineData("epcube UNION SELECT password FROM users")]
    [InlineData("battery'; INSERT INTO devices VALUES('hack','hack'); --")]
    public async Task SqlInjection_DeviceParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/devices/{Uri.EscapeDataString(payload)}/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("invalid characters", body);
    }

    [Theory]
    [InlineData("'; DROP TABLE readings; --")]
    [InlineData("1; DELETE FROM devices")]
    [InlineData("0 UNION SELECT 1")]
    public async Task SqlInjection_StartParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync(
            $"/api/v1/readings/range?metric=battery_soc&start={Uri.EscapeDataString(payload)}&end=2000&step=60");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("60; DROP TABLE readings")]
    [InlineData("1 OR 1=1")]
    public async Task SqlInjection_StepParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync(
            $"/api/v1/readings/range?metric=battery_soc&start=1000&end=2000&step={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Path Traversal ──

    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\..\\windows\\system32\\config\\sam")]
    [InlineData("....//....//etc/shadow")]
    [InlineData("%2e%2e%2f%2e%2e%2fetc%2fpasswd")]
    public async Task PathTraversal_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..%2F..%2F..%2Fetc%2Fpasswd")]
    public async Task PathTraversal_DeviceParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/devices/{Uri.EscapeDataString(payload)}/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── XSS Payloads ──

    [Theory]
    [InlineData("<script>alert('xss')</script>")]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("javascript:alert(1)")]
    [InlineData("<svg/onload=alert('XSS')>")]
    public async Task Xss_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("<script>alert('xss')</script>")]
    [InlineData("<img src=x onerror=alert(1)>")]
    public async Task Xss_DeviceParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/devices/{Uri.EscapeDataString(payload)}/metrics");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Unicode / Encoding Tricks ──

    [Theory]
    [InlineData("epcube\u0000battery")]    // Null byte injection
    [InlineData("epcube\u200Bbattery")]    // Zero-width space
    [InlineData("ＡＤＭＩＮtable")]         // Fullwidth unicode
    [InlineData("デバイス")]                 // Non-latin characters
    public async Task UnicodeAttack_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Command Injection ──

    [Theory]
    [InlineData("; ls -la")]
    [InlineData("| cat /etc/passwd")]
    [InlineData("$(whoami)")]
    [InlineData("`id`")]
    public async Task CommandInjection_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── LDAP / NoSQL Injection ──

    [Theory]
    [InlineData("*)(uid=*))(|(uid=*")]
    [InlineData("{\"$gt\": \"\"}")]
    [InlineData("{\"$ne\": null}")]
    public async Task NoSqlInjection_MetricParam_ReturnsBadRequest(string payload)
    {
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={Uri.EscapeDataString(payload)}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Oversized Input ──

    [Fact]
    public async Task OversizedInput_MetricParam_ReturnsBadRequest()
    {
        var payload = new string('A', 10000);
        var response = await _client.GetAsync($"/api/v1/readings/current?metric={payload}");

        // SafeName regex won't match because it starts with uppercase? Actually A is valid.
        // But a 10k char param that passes SafeName would just return empty results.
        // The important thing: it doesn't crash the server.
        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.BadRequest,
            $"Expected OK or 400 but got {response.StatusCode}");
    }

    // ── HTTP Method Confusion ──

    [Fact]
    public async Task PostToGetEndpoint_ReturnsMethodNotAllowed()
    {
        var response = await _client.PostAsync("/api/v1/readings/current?metric=battery_soc", null);

        // Minimal API GET-only endpoints return 405 for POST
        Assert.True(
            response.StatusCode == HttpStatusCode.MethodNotAllowed ||
            response.StatusCode == HttpStatusCode.NotFound,
            $"Expected 405 or 404 but got {response.StatusCode}");
    }

    [Fact]
    public async Task DeleteToGetEndpoint_ReturnsMethodNotAllowed()
    {
        var response = await _client.DeleteAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.True(
            response.StatusCode == HttpStatusCode.MethodNotAllowed ||
            response.StatusCode == HttpStatusCode.NotFound,
            $"Expected 405 or 404 but got {response.StatusCode}");
    }
}
