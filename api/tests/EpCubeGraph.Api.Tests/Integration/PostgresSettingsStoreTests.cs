using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class PostgresSettingsStoreTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private readonly PostgresSettingsStore _store;
    private readonly string _connectionString;

    public PostgresSettingsStoreTests(PostgresFixture fixture)
    {
        _fixture = fixture;
        _connectionString = fixture.ConnectionString;
        _store = new PostgresSettingsStore(_connectionString);
    }

    public async Task InitializeAsync() => await _fixture.ClearDataAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ── Settings ──

    [Fact]
    public async Task GetAllSettings_ReturnsListIncludingInsertedKeys()
    {
        // Arrange — insert a known key so the result is never ambiguously empty
        await _store.UpdateSettingAsync("get_all_test_key", "1");

        // Act
        var result = await _store.GetAllSettingsAsync();

        // Assert
        Assert.NotNull(result);
        Assert.Contains(result, s => s.Key == "get_all_test_key");
    }

    [Fact]
    public async Task UpdateSetting_CreatesAndReturnsEntry()
    {
        // Act
        var entry = await _store.UpdateSettingAsync("create_test_key", "42");

        // Assert
        Assert.Equal("create_test_key", entry.Key);
        Assert.Equal("42", entry.Value);
    }

    [Fact]
    public async Task GetSetting_ReturnsUpdatedValue()
    {
        // Arrange
        await _store.UpdateSettingAsync("get_test_key", "100");

        // Act
        var entry = await _store.GetSettingAsync("get_test_key");

        // Assert
        Assert.NotNull(entry);
        Assert.Equal("100", entry.Value);
    }

    [Fact]
    public async Task GetSetting_ReturnsNullForMissing()
    {
        // Act
        var entry = await _store.GetSettingAsync("definitely_nonexistent_key_abc123");

        // Assert
        Assert.Null(entry);
    }

    [Fact]
    public async Task UpdateSetting_OverwritesExistingValue()
    {
        // Arrange
        await _store.UpdateSettingAsync("overwrite_test_key", "10");

        // Act
        var updated = await _store.UpdateSettingAsync("overwrite_test_key", "20");

        // Assert
        Assert.Equal("20", updated.Value);
    }

    // ── Panel Hierarchy ──

    [Fact]
    public async Task GetHierarchy_ReturnsNotNull()
    {
        // Act
        var result = await _store.GetHierarchyAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateHierarchy_InsertsAndReturnsEntries()
    {
        // Arrange — unique GIDs for this test
        var entries = new List<PanelHierarchyInputEntry>
        {
            new(10100, 10200),
            new(10100, 10300),
        };

        // Act
        var result = await _store.UpdateHierarchyAsync(entries);

        // Assert
        Assert.Contains(result, e => e.ParentDeviceGid == 10100 && e.ChildDeviceGid == 10200);
        Assert.Contains(result, e => e.ParentDeviceGid == 10100 && e.ChildDeviceGid == 10300);
    }

    [Fact]
    public async Task UpdateHierarchy_ReplacesAllEntries()
    {
        // Arrange — insert initial set
        await _store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>
        {
            new(20100, 20200),
        });

        // Act — replace with completely different set
        var newEntries = new List<PanelHierarchyInputEntry>
        {
            new(20500, 20600),
        };
        var result = await _store.UpdateHierarchyAsync(newEntries);

        // Assert — old entries gone, only new entry present
        Assert.Single(result);
        Assert.Equal(20500, result[0].ParentDeviceGid);
        Assert.Equal(20600, result[0].ChildDeviceGid);
    }

    [Fact]
    public async Task UpdateHierarchy_EmptyListClearsAll()
    {
        // Arrange
        await _store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>
        {
            new(30100, 30200),
        });

        // Act
        var result = await _store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>());

        // Assert
        Assert.Empty(result);
    }

    // ── Display Name Overrides ──

    [Fact]
    public async Task GetDisplayNames_ReturnsNotNull()
    {
        // Act
        var result = await _store.GetDisplayNamesAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateDisplayNames_InsertsOverrides()
    {
        // Arrange — unique device GID
        var overrides = new List<DisplayNameInputEntry>
        {
            new(null, "Main Panel"),
            new("1", "Kitchen"),
        };

        // Act
        var result = await _store.UpdateDisplayNamesForDeviceAsync(99991, overrides);

        // Assert
        Assert.Equal(2, result.Count);
        Assert.Contains(result, o => o.DisplayName == "Main Panel" && o.ChannelNumber == null);
        Assert.Contains(result, o => o.DisplayName == "Kitchen" && o.ChannelNumber == "1");
    }

    [Fact]
    public async Task UpdateDisplayNames_ReplacesForDevice()
    {
        // Arrange — unique device GID
        await _store.UpdateDisplayNamesForDeviceAsync(88881, new List<DisplayNameInputEntry>
        {
            new("1", "Old Name"),
        });

        // Act
        var result = await _store.UpdateDisplayNamesForDeviceAsync(88881, new List<DisplayNameInputEntry>
        {
            new("1", "New Name"),
        });

        // Assert
        Assert.Single(result);
        Assert.Equal("New Name", result[0].DisplayName);
    }

    [Fact]
    public async Task DeleteDisplayName_ReturnsTrueWhenDeleted()
    {
        // Arrange — unique device GID
        await _store.UpdateDisplayNamesForDeviceAsync(77771, new List<DisplayNameInputEntry>
        {
            new("5", "To Delete"),
        });

        // Act
        var deleted = await _store.DeleteDisplayNameAsync(77771, "5");

        // Assert
        Assert.True(deleted);
    }

    [Fact]
    public async Task DeleteDisplayName_ReturnsFalseWhenNotFound()
    {
        // Act
        var deleted = await _store.DeleteDisplayNameAsync(66661, "nonexistent");

        // Assert
        Assert.False(deleted);
    }

    // ── Concurrency ──

    [Fact]
    public async Task ConcurrentEnsureTables_DoesNotThrow()
    {
        // Arrange — fresh store so tables haven't been created yet
        var store = new PostgresSettingsStore(_connectionString);

        // Act — fire 10 concurrent operations that each trigger EnsureTablesAsync
        var tasks = Enumerable.Range(0, 10)
            .Select(_ => store.GetAllSettingsAsync())
            .ToArray();

        // Assert — no exceptions from the concurrent CREATE TABLE IF NOT EXISTS calls
        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.NotNull(r));
    }
}
