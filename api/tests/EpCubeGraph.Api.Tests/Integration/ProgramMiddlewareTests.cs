using System.Net;
using System.Text.Json;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// Tests that exercise Program.cs middleware paths not covered by
/// the default Development-environment tests:
/// - Global exception handler (non-Development only)
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
    public async Task Production_ErrorHandling_Returns422Json()
    {
        // In production, endpoint-level catch blocks return 422 with error JSON.
        // This verifies the error response format is correct in production mode.
        _factory.MockStore.ShouldThrow = true;

        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(body);
        Assert.Equal("error", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("execution", doc.RootElement.GetProperty("errorType").GetString());
    }

    [Fact]
    public async Task Production_DoesNotExposeSwagger()
    {
        var response = await _client.GetAsync("/swagger/v1/swagger.json");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Production_HealthEndpoint_StillWorks()
    {
        var response = await _client.GetAsync("/api/v1/health");

        Assert.True(
            response.StatusCode == HttpStatusCode.OK ||
            response.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected OK or 503 but got {response.StatusCode}");
    }

    [Fact]
    public async Task Cors_AllowedOrigin_ReturnsHeaders()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", "https://test-dashboard.example.com");

        var response = await _client.SendAsync(request);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal("https://test-dashboard.example.com",
            response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task Cors_DisallowedOrigin_NoHeaders()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Add("Origin", "https://evil.example.com");

        var response = await _client.SendAsync(request);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Cors_Preflight_ReturnsAllowedMethodsAndHeaders()
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/health");
        request.Headers.Add("Origin", "https://test-dashboard.example.com");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "Authorization");

        var response = await _client.SendAsync(request);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.True(response.Headers.Contains("Access-Control-Allow-Methods"));
        Assert.True(response.Headers.Contains("Access-Control-Allow-Headers"));
    }
}

/// <summary>
/// Tests the NoAuthHandler dev bypass path in Program.cs.
/// Uses EPCUBE_DISABLE_AUTH=true with Development environment.
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
                builder.UseSetting("ConnectionStrings:DefaultConnection", "Host=localhost;Port=5432;Database=test");
                builder.ConfigureTestServices(services =>
                {
                    var descriptors = services
                        .Where(d => d.ServiceType == typeof(IMetricsStore))
                        .ToList();
                    foreach (var d in descriptors)
                        services.Remove(d);
                    services.AddSingleton<IMetricsStore>(new ConfigurableMockStore());
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
        var response = await _client.GetAsync("/api/v1/readings/current?metric=battery_soc");

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

/// <summary>
/// Tests that the app starts with default connection string when
/// ConnectionStrings:DefaultConnection is not configured.
/// </summary>
public class ProgramDefaultConnectionTests
{

    [Fact]
    public void GetRequiredConnectionString_ReturnsValue_WhenPresent()
    {
        // Arrange
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Host=test;Database=db",
            })
            .Build();

        // Act
        var result = Startup.GetRequiredConnectionString(config);

        // Assert
        Assert.Equal("Host=test;Database=db", result);
    }

    [Fact]
    public void GetRequiredConnectionString_Throws_WhenMissing()
    {
        // Arrange
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        // Act + Assert
        var ex = Assert.Throws<InvalidOperationException>(
            () => Startup.GetRequiredConnectionString(config));
        Assert.Contains("ConnectionStrings:DefaultConnection", ex.Message);
    }
}
