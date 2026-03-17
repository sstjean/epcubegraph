using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Tests that exercise Program.cs middleware paths not covered by
/// the default Development-environment tests:
/// - Global exception handler (non-Development only, lines 51-64)
/// - Swagger disabled in Production
/// - NoAuthHandler bypass in Development with EPCUBE_DISABLE_AUTH=true
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

/// <summary>
/// Tests the NoAuthHandler dev bypass path in Program.cs (lines 17-23).
/// Uses EPCUBE_DISABLE_AUTH=true with Development environment so
/// NoAuthHandler is activated instead of Entra ID.
/// </summary>
public class NoAuthBypassTests : IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public NoAuthBypassTests()
    {
        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("Authentication:DisableAuth", "true");
                builder.UseSetting("VictoriaMetrics:Url", "http://localhost:0");
                builder.ConfigureTestServices(services =>
                {
                    // Replace VM client so endpoints don't make real HTTP calls
                    var descriptors = services
                        .Where(d => d.ServiceType == typeof(IVictoriaMetricsClient))
                        .ToList();
                    foreach (var d in descriptors)
                        services.Remove(d);
                    services.AddSingleton<IVictoriaMetricsClient>(new ConfigurableMockVmClient());
                });
            });
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Fact]
    public async Task NoAuth_AuthenticatedEndpoints_Return200_WithoutToken()
    {
        // With NoAuthHandler active, requests should succeed without any JWT
        var response = await _client.GetAsync("/api/v1/query?query=up");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task NoAuth_HealthEndpoint_StillWorks()
    {
        var response = await _client.GetAsync("/api/v1/health");

        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected OK or 503 but got {response.StatusCode}");
    }
}
