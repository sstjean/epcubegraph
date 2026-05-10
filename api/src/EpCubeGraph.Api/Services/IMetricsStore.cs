using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Services;

public interface IMetricsStore
{
    Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(CancellationToken ct = default);

    Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(string? status, CancellationToken ct = default);

    Task<IReadOnlyList<string>> GetDeviceMetricsAsync(string deviceId, CancellationToken ct = default);

    Task<IReadOnlyList<Reading>> GetCurrentReadingsAsync(string metricName, CancellationToken ct = default);

    Task<IReadOnlyList<TimeSeries>> GetRangeReadingsAsync(
        string metricName, long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default);

    Task<IReadOnlyList<TimeSeries>> GetGridReadingsAsync(
        long startEpoch, long endEpoch, int stepSeconds, CancellationToken ct = default);

    Task<IReadOnlyList<PendingReplacement>> GetPendingReplacementsAsync(CancellationToken ct = default);

    Task<DismissResponse?> DismissPendingReplacementAsync(int id, CancellationToken ct = default);

    Task<MergePreviewResponse?> GetMergePreviewAsync(string oldDeviceId, string newDeviceId, CancellationToken ct = default);

    Task<MergeResponse?> ExecuteMergeAsync(string oldDeviceId, string newDeviceId, CancellationToken ct = default);

    Task<bool> PingAsync(CancellationToken ct = default);
}

public sealed class MergeValidationException : Exception
{
    public MergeValidationException(string message) : base(message) { }
}
