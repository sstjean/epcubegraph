using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Tests that exercise Program.cs middleware paths not covered by
/// the default Development-environment tests:
/// - Global exception handler (non-Development only, lines 51-64)
/// - Swagger disabled in Production
/// </summary>
public class ProgramMiddlewareTests : IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public ProgramMiddlewareTests()
    {
        _factory = new MockableTestFactory { EnvironmentOverride = "Production" };
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Fact]
    public async Task GlobalExceptionHandler_Returns500Json_InProduction()
    {
        // Make the mock throw InvalidOperationException (not HttpRequestException).
        // Query endpoints only catch HttpRequestException, so this propagates
        // to the global exception handler registered in Program.cs.
        _factory.MockClient.ThrowUnhandled = true;

        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(body);
        Assert.Equal("error", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("internal", doc.RootElement.GetProperty("errorType").GetString());
        Assert.Equal("An unexpected error occurred", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Production_DoesNotExposeSwagger()
    {
        var response = await _client.GetAsync("/swagger/v1/swagger.json");

        // Swagger is development-only; in Production it should 404
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Production_HealthEndpoint_StillWorks()
    {
        var response = await _client.GetAsync("/api/v1/health");

        // Health endpoint should still work in Production
        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected OK or 503 but got {response.StatusCode}");
    }
}
