using System.Security.Claims;
using System.Text.Encodings.Web;
using EpCubeGraph.Api.Models;
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
/// configurable mock IMetricsStore so endpoint handler logic
/// can be exercised in tests.
/// </summary>
public class MockableTestFactory : WebApplicationFactory<Program>
{
    public ConfigurableMockStore MockStore { get; } = new();

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
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Port=0;Database=test",
                ["Cors:AllowedOrigin"] = "https://test-dashboard.example.com"
            });
        });

        builder.ConfigureTestServices(services =>
        {
            // Remove all existing IMetricsStore registrations
            var descriptors = services
                .Where(d => d.ServiceType == typeof(IMetricsStore))
                .ToList();
            foreach (var d in descriptors)
                services.Remove(d);

            // Register our mock as the sole implementation
            services.AddSingleton<IMetricsStore>(MockStore);

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
/// Configurable mock of IMetricsStore.
/// Tests configure behaviour before making HTTP calls.
/// </summary>
public sealed class ConfigurableMockStore : IMetricsStore
{
    public bool ShouldThrow { get; set; }
    public string ThrowMessage { get; set; } = "Database unavailable";

    /// <summary>
    /// When true, throws InvalidOperationException to test error handling.
    /// </summary>
    public bool ThrowUnhandled { get; set; }

    public IReadOnlyList<DeviceInfo> DevicesResult { get; set; } = Array.Empty<DeviceInfo>();
    public IReadOnlyList<string> DeviceMetricsResult { get; set; } = Array.Empty<string>();
    public IReadOnlyList<Reading> CurrentReadingsResult { get; set; } = Array.Empty<Reading>();
    public IReadOnlyList<TimeSeries> RangeResult { get; set; } = Array.Empty<TimeSeries>();
    public IReadOnlyList<TimeSeries> GridResult { get; set; } = Array.Empty<TimeSeries>();
    public bool PingResult { get; set; } = true;

    public void Reset()
    {
        ShouldThrow = false;
        ThrowMessage = "Database unavailable";
        ThrowUnhandled = false;
        DevicesResult = Array.Empty<DeviceInfo>();
        DeviceMetricsResult = Array.Empty<string>();
        CurrentReadingsResult = Array.Empty<Reading>();
        RangeResult = Array.Empty<TimeSeries>();
        GridResult = Array.Empty<TimeSeries>();
        PingResult = true;
    }

    public Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(CancellationToken ct = default)
    {
        if (ThrowUnhandled) throw new InvalidOperationException("Simulated unhandled error");
        if (ShouldThrow) throw new Exception(ThrowMessage);
        return Task.FromResult(DevicesResult);
    }

    public Task<IReadOnlyList<string>> GetDeviceMetricsAsync(string deviceId, CancellationToken ct = default)
    {
        if (ShouldThrow) throw new Exception(ThrowMessage);
        return Task.FromResult(DeviceMetricsResult);
    }

    public Task<IReadOnlyList<Reading>> GetCurrentReadingsAsync(string metricName, CancellationToken ct = default)
    {
        if (ThrowUnhandled) throw new InvalidOperationException("Simulated unhandled error");
        if (ShouldThrow) throw new Exception(ThrowMessage);
        return Task.FromResult(CurrentReadingsResult);
    }

    public Task<IReadOnlyList<TimeSeries>> GetRangeReadingsAsync(
        string metricName, long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default)
    {
        if (ThrowUnhandled) throw new InvalidOperationException("Simulated unhandled error");
        if (ShouldThrow) throw new Exception(ThrowMessage);
        return Task.FromResult(RangeResult);
    }

    public Task<IReadOnlyList<TimeSeries>> GetGridReadingsAsync(
        long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default)
    {
        if (ShouldThrow) throw new Exception(ThrowMessage);
        return Task.FromResult(GridResult);
    }

    public Task<bool> PingAsync(CancellationToken ct = default)
    {
        if (ShouldThrow) return Task.FromResult(false);
        return Task.FromResult(PingResult);
    }
}
