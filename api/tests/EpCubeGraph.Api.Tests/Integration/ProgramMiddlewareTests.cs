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
        // Arrange
        // Make the mock throw InvalidOperationException (not HttpRequestException).
        // Query endpoints only catch HttpRequestException, so this propagates
        // to the global exception handler registered in Program.cs.
        _factory.MockClient.ThrowUnhandled = true;

        // Act
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
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
        // Act
        var response = await _client.GetAsync("/swagger/v1/swagger.json");

        // Assert
        // Swagger is development-only; in Production it should 404
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Production_HealthEndpoint_StillWorks()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        // Health endpoint should still work in Production
        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected OK or 503 but got {response.StatusCode}");
    }

    [Fact]
    public async Task Cors_AllowedOrigin_ReturnsHeaders()
    {
        // Arrange — simple GET with Origin header
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", "https://test-dashboard.example.com");

        // Act
        var response = await _client.SendAsync(request);

        // Assert
        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal("https://test-dashboard.example.com",
            response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task Cors_DisallowedOrigin_NoHeaders()
    {
        // Arrange — request from a different origin
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", "https://evil.example.com");

        // Act
        var response = await _client.SendAsync(request);

        // Assert
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Cors_Preflight_ReturnsAllowedMethodsAndHeaders()
    {
        // Arrange — OPTIONS preflight request
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/health");
        request.Headers.Add("Origin", "https://test-dashboard.example.com");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "Authorization");

        // Act
        var response = await _client.SendAsync(request);

        // Assert
        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.True(response.Headers.Contains("Access-Control-Allow-Methods"));
        Assert.True(response.Headers.Contains("Access-Control-Allow-Headers"));
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
        // Act
        // With NoAuthHandler active, requests should succeed without any JWT
        var response = await _client.GetAsync("/api/v1/query?query=up");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task NoAuth_HealthEndpoint_StillWorks()
    {
        // Act
        var response = await _client.GetAsync("/api/v1/health");

        // Assert
        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected OK or 503 but got {response.StatusCode}");
    }
}
