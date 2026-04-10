using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Services;

public interface IVueStore
{
    // Devices
    Task<IReadOnlyList<VueDeviceInfo>> GetDevicesAsync(CancellationToken ct = default);
    Task<VueDeviceInfo?> GetDeviceAsync(long deviceGid, CancellationToken ct = default);

    // Current Readings
    Task<VueCurrentReadingsResponse?> GetCurrentReadingsAsync(long deviceGid, CancellationToken ct = default);

    // Range Readings
    Task<VueRangeReadingsResponse?> GetRangeReadingsAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, string? channels = null, CancellationToken ct = default);

    // Panel Totals (deduplication)
    Task<PanelTotalResponse?> GetPanelTotalAsync(long deviceGid, CancellationToken ct = default);
    Task<PanelTotalRangeResponse?> GetPanelTotalRangeAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default);

    // Home Total
    Task<HomeTotalResponse> GetHomeTotalAsync(CancellationToken ct = default);
    Task<HomeTotalRangeResponse> GetHomeTotalRangeAsync(
        DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default);
}
