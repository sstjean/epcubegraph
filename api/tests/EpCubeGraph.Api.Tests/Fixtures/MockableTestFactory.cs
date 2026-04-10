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
    public ConfigurableMockSettingsStore MockSettingsStore { get; } = new();
    public ConfigurableMockVueStore MockVueStore { get; } = new();

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

            // Register mock settings store
            var settingsDescriptors = services
                .Where(d => d.ServiceType == typeof(ISettingsStore))
                .ToList();
            foreach (var d in settingsDescriptors)
                services.Remove(d);
            services.AddSingleton<ISettingsStore>(MockSettingsStore);

            // Register mock Vue store
            var vueDescriptors = services
                .Where(d => d.ServiceType == typeof(IVueStore))
                .ToList();
            foreach (var d in vueDescriptors)
                services.Remove(d);
            services.AddSingleton<IVueStore>(MockVueStore);

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

/// <summary>
/// Configurable mock of ISettingsStore.
/// Tests configure behaviour before making HTTP calls.
/// </summary>
public sealed class ConfigurableMockSettingsStore : ISettingsStore
{
    private List<SettingEntry> _settings = new();
    private List<PanelHierarchyEntry> _hierarchy = new();
    private List<DisplayNameOverride> _displayNames = new();
    private SettingEntry? _lastUpdated;

    public void SetSettings(List<SettingEntry> settings) => _settings = settings;
    public void SetHierarchy(List<PanelHierarchyEntry> hierarchy) => _hierarchy = hierarchy;
    public void SetDisplayNames(List<DisplayNameOverride> names) => _displayNames = names;

    public void Reset()
    {
        _settings = new List<SettingEntry>();
        _hierarchy = new List<PanelHierarchyEntry>();
        _displayNames = new List<DisplayNameOverride>();
        _lastUpdated = null;
    }

    public Task<IReadOnlyList<SettingEntry>> GetAllSettingsAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<SettingEntry>>(_settings);

    public Task<SettingEntry?> GetSettingAsync(string key, CancellationToken ct = default)
        => Task.FromResult(_settings.FirstOrDefault(s => s.Key == key));

    public Task<SettingEntry> UpdateSettingAsync(string key, string value, CancellationToken ct = default)
    {
        var entry = new SettingEntry(key, value, DateTimeOffset.UtcNow);
        _lastUpdated = entry;
        var idx = _settings.FindIndex(s => s.Key == key);
        if (idx >= 0) _settings[idx] = entry;
        else _settings.Add(entry);
        return Task.FromResult(entry);
    }

    public Task<IReadOnlyList<PanelHierarchyEntry>> GetHierarchyAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<PanelHierarchyEntry>>(_hierarchy);

    public Task<IReadOnlyList<PanelHierarchyEntry>> UpdateHierarchyAsync(
        IReadOnlyList<PanelHierarchyInputEntry> entries, CancellationToken ct = default)
    {
        _hierarchy = entries.Select((e, i) => new PanelHierarchyEntry(i + 1, e.ParentDeviceGid, e.ChildDeviceGid)).ToList();
        return Task.FromResult<IReadOnlyList<PanelHierarchyEntry>>(_hierarchy);
    }

    public Task<IReadOnlyList<DisplayNameOverride>> GetDisplayNamesAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DisplayNameOverride>>(_displayNames);

    public Task<IReadOnlyList<DisplayNameOverride>> UpdateDisplayNamesForDeviceAsync(
        long deviceGid, IReadOnlyList<DisplayNameInputEntry> overrides, CancellationToken ct = default)
    {
        _displayNames.RemoveAll(d => d.DeviceGid == deviceGid);
        var newEntries = overrides.Select((o, i) =>
            new DisplayNameOverride(_displayNames.Count + i + 1, deviceGid, o.ChannelNumber, o.DisplayName)).ToList();
        _displayNames.AddRange(newEntries);
        return Task.FromResult<IReadOnlyList<DisplayNameOverride>>(newEntries);
    }

    public Task<bool> DeleteDisplayNameAsync(long deviceGid, string channelNumber, CancellationToken ct = default)
    {
        var removed = _displayNames.RemoveAll(d => d.DeviceGid == deviceGid && d.ChannelNumber == channelNumber);
        return Task.FromResult(removed > 0);
    }
}

/// <summary>
/// Configurable mock of IVueStore for endpoint testing.
/// </summary>
public sealed class ConfigurableMockVueStore : IVueStore
{
    public IReadOnlyList<VueDeviceInfo> DevicesResult { get; set; } = Array.Empty<VueDeviceInfo>();
    public VueCurrentReadingsResponse? CurrentReadingsResult { get; set; }
    public VueRangeReadingsResponse? RangeReadingsResult { get; set; }
    public PanelTotalResponse? PanelTotalResult { get; set; }
    public PanelTotalRangeResponse? PanelTotalRangeResult { get; set; }
    public HomeTotalResponse HomeTotalResult { get; set; } = new(0, 0, Array.Empty<PanelChild>());
    public HomeTotalRangeResponse HomeTotalRangeResult { get; set; } = new("", "", "1m", Array.Empty<TimeSeriesPoint>());

    public void Reset()
    {
        DevicesResult = Array.Empty<VueDeviceInfo>();
        CurrentReadingsResult = null;
        RangeReadingsResult = null;
        PanelTotalResult = null;
        PanelTotalRangeResult = null;
        HomeTotalResult = new(0, 0, Array.Empty<PanelChild>());
        HomeTotalRangeResult = new("", "", "1m", Array.Empty<TimeSeriesPoint>());
    }

    public Task<IReadOnlyList<VueDeviceInfo>> GetDevicesAsync(CancellationToken ct = default)
        => Task.FromResult(DevicesResult);

    public Task<VueDeviceInfo?> GetDeviceAsync(long deviceGid, CancellationToken ct = default)
        => Task.FromResult(DevicesResult.FirstOrDefault(d => d.DeviceGid == deviceGid));

    public Task<VueCurrentReadingsResponse?> GetCurrentReadingsAsync(long deviceGid, CancellationToken ct = default)
        => Task.FromResult(CurrentReadingsResult);

    public Task<VueRangeReadingsResponse?> GetRangeReadingsAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, string? channels = null, CancellationToken ct = default)
        => Task.FromResult(RangeReadingsResult);

    public Task<PanelTotalResponse?> GetPanelTotalAsync(long deviceGid, CancellationToken ct = default)
        => Task.FromResult(PanelTotalResult);

    public Task<PanelTotalRangeResponse?> GetPanelTotalRangeAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default)
        => Task.FromResult(PanelTotalRangeResult);

    public Task<HomeTotalResponse> GetHomeTotalAsync(CancellationToken ct = default)
        => Task.FromResult(HomeTotalResult);

    public Task<HomeTotalRangeResponse> GetHomeTotalRangeAsync(
        DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default)
        => Task.FromResult(HomeTotalRangeResult);
}
