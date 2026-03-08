using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using EpCubeGraph.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EpCubeGraph.Api.Tests.Fixtures;

/// <summary>
/// WebApplicationFactory that bypasses Entra ID auth and injects a
/// configurable mock IVictoriaMetricsClient so endpoint handler logic
/// can be exercised in tests.
/// </summary>
public class MockableTestFactory : WebApplicationFactory<Program>
{
    /// <summary>
    /// The mock VM client shared with tests.  Tests configure its
    /// behaviour before making HTTP calls.
    /// </summary>
    public ConfigurableMockVmClient MockClient { get; } = new();

    /// <summary>
    /// When non-null, overrides the ASPNETCORE_ENVIRONMENT.
    /// </summary>
    public string? EnvironmentOverride { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (EnvironmentOverride is not null)
            builder.UseEnvironment(EnvironmentOverride);

        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AzureAd:Instance"] = "https://login.microsoftonline.com/",
                ["AzureAd:TenantId"] = "00000000-0000-0000-0000-000000000000",
                ["AzureAd:ClientId"] = "00000000-0000-0000-0000-000000000001",
                ["AzureAd:Audience"] = "api://00000000-0000-0000-0000-000000000001",
                ["VictoriaMetrics:Url"] = "http://localhost:0"
            });
        });

        builder.ConfigureTestServices(services =>
        {
            // Remove ALL existing IVictoriaMetricsClient registrations
            // (the typed HttpClient factory registers multiple descriptors)
            var descriptors = services
                .Where(d => d.ServiceType == typeof(IVictoriaMetricsClient))
                .ToList();
            foreach (var d in descriptors)
                services.Remove(d);

            // Register our mock as the sole implementation
            services.AddSingleton<IVictoriaMetricsClient>(MockClient);

            // Bypass Entra ID: add "Test" scheme that always succeeds
            services.AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });

            services.AddAuthorization(options =>
            {
                options.DefaultPolicy = new AuthorizationPolicyBuilder("Test")
                    .RequireAuthenticatedUser()
                    .Build();
            });
        });
    }

    /// <summary>
    /// Authentication handler that always succeeds with a test identity
    /// carrying the user_impersonation scope.
    /// </summary>
    private sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public TestAuthHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder)
            : base(options, logger, encoder) { }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new[]
            {
                new Claim(ClaimTypes.Name, "TestUser"),
                new Claim("http://schemas.microsoft.com/identity/claims/scope", "user_impersonation")
            };
            var identity = new ClaimsIdentity(claims, "Test");
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, "Test");
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}

/// <summary>
/// Configurable mock of IVictoriaMetricsClient.
/// By default returns a success response. Tests can set ShouldThrow
/// to simulate HTTP failures, or provide custom response JSON.
/// </summary>
public sealed class ConfigurableMockVmClient : IVictoriaMetricsClient
{
    public bool ShouldThrow { get; set; }
    public string ThrowMessage { get; set; } = "VictoriaMetrics unavailable";

    /// <summary>
    /// When true, throws InvalidOperationException instead of HttpRequestException.
    /// This bypasses endpoint-level catch(HttpRequestException) blocks and
    /// triggers the global exception handler in Program.cs.
    /// </summary>
    public bool ThrowUnhandled { get; set; }

    public string QueryResponse { get; set; } =
        """{"status":"success","data":{"resultType":"vector","result":[]}}""";

    public string QueryRangeResponse { get; set; } =
        """{"status":"success","data":{"resultType":"matrix","result":[]}}""";

    public string SeriesResponse { get; set; } =
        """{"status":"success","data":[]}""";

    public string LabelsResponse { get; set; } =
        """{"status":"success","data":["__name__","device"]}""";

    public string LabelValuesResponse { get; set; } =
        """{"status":"success","data":["epcube_battery","epcube_solar"]}""";

    // Track calls for assertions
    public string? LastSeriesMatch { get; private set; }
    public string? LastSeriesStart { get; private set; }
    public string? LastSeriesEnd { get; private set; }

    /// <summary>
    /// Reset all configurable state to defaults.
    /// Call before each test to avoid cross-test contamination.
    /// </summary>
    public void Reset()
    {
        ShouldThrow = false;
        ThrowMessage = "VictoriaMetrics unavailable";
        ThrowUnhandled = false;
        QueryResponse = """{"status":"success","data":{"resultType":"vector","result":[]}}""";
        QueryRangeResponse = """{"status":"success","data":{"resultType":"matrix","result":[]}}""";
        SeriesResponse = """{"status":"success","data":[]}""";
        LabelsResponse = """{"status":"success","data":["__name__","device"]}""";
        LabelValuesResponse = """{"status":"success","data":["epcube_battery","epcube_solar"]}""";
        LastSeriesMatch = null;
        LastSeriesStart = null;
        LastSeriesEnd = null;
    }

    public Task<JsonElement> QueryAsync(string query, string? time = null, CancellationToken ct = default)
    {
        if (ThrowUnhandled) throw new InvalidOperationException("Simulated unhandled error");
        if (ShouldThrow) throw new HttpRequestException(ThrowMessage);
        return Task.FromResult(Parse(QueryResponse));
    }

    public Task<JsonElement> QueryRangeAsync(string query, string start, string end, string step, CancellationToken ct = default)
    {
        if (ThrowUnhandled) throw new InvalidOperationException("Simulated unhandled error");
        if (ShouldThrow) throw new HttpRequestException(ThrowMessage);
        return Task.FromResult(Parse(QueryRangeResponse));
    }

    public Task<JsonElement> SeriesAsync(string match, string? start = null, string? end = null, CancellationToken ct = default)
    {
        LastSeriesMatch = match;
        LastSeriesStart = start;
        LastSeriesEnd = end;
        if (ShouldThrow) throw new HttpRequestException(ThrowMessage);
        return Task.FromResult(Parse(SeriesResponse));
    }

    public Task<JsonElement> LabelsAsync(CancellationToken ct = default)
    {
        if (ShouldThrow) throw new HttpRequestException(ThrowMessage);
        return Task.FromResult(Parse(LabelsResponse));
    }

    public Task<JsonElement> LabelValuesAsync(string labelName, CancellationToken ct = default)
    {
        if (ShouldThrow) throw new HttpRequestException(ThrowMessage);
        return Task.FromResult(Parse(LabelValuesResponse));
    }

    private static JsonElement Parse(string json) =>
        JsonDocument.Parse(json).RootElement.Clone();
}
