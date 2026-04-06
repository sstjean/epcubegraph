using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Services;

public interface ISettingsStore
{
    // Settings (key-value)
    Task<IReadOnlyList<SettingEntry>> GetAllSettingsAsync(CancellationToken ct = default);
    Task<SettingEntry?> GetSettingAsync(string key, CancellationToken ct = default);
    Task<SettingEntry> UpdateSettingAsync(string key, string value, CancellationToken ct = default);

    // Panel Hierarchy
    Task<IReadOnlyList<PanelHierarchyEntry>> GetHierarchyAsync(CancellationToken ct = default);
    Task<IReadOnlyList<PanelHierarchyEntry>> UpdateHierarchyAsync(
        IReadOnlyList<PanelHierarchyInputEntry> entries, CancellationToken ct = default);

    // Display Name Overrides
    Task<IReadOnlyList<DisplayNameOverride>> GetDisplayNamesAsync(CancellationToken ct = default);
    Task<IReadOnlyList<DisplayNameOverride>> UpdateDisplayNamesForDeviceAsync(
        long deviceGid, IReadOnlyList<DisplayNameInputEntry> overrides, CancellationToken ct = default);
    Task<bool> DeleteDisplayNameAsync(long deviceGid, string channelNumber, CancellationToken ct = default);
}
