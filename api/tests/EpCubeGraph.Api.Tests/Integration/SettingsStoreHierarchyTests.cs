using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreHierarchyTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public SettingsStoreHierarchyTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresSettingsStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresSettingsStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetHierarchy_ReturnsNotNull()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetHierarchyAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateHierarchy_InsertsAndReturnsEntries()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        var entries = new List<PanelHierarchyInputEntry>
        {
            new(10100, 10200),
            new(10100, 10300),
        };

        // Act
        var result = await store.UpdateHierarchyAsync(entries);

        // Assert
        Assert.Contains(result, e => e.ParentDeviceGid == 10100 && e.ChildDeviceGid == 10200);
        Assert.Contains(result, e => e.ParentDeviceGid == 10100 && e.ChildDeviceGid == 10300);
    }

    [Fact]
    public async Task UpdateHierarchy_ReplacesAllEntries()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>
        {
            new(20100, 20200),
        });

        // Act
        var newEntries = new List<PanelHierarchyInputEntry>
        {
            new(20500, 20600),
        };
        var result = await store.UpdateHierarchyAsync(newEntries);

        // Assert
        Assert.Single(result);
        Assert.Equal(20500, result[0].ParentDeviceGid);
        Assert.Equal(20600, result[0].ChildDeviceGid);
    }

    [Fact]
    public async Task UpdateHierarchy_EmptyListClearsAll()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>
        {
            new(30100, 30200),
        });

        // Act
        var result = await store.UpdateHierarchyAsync(new List<PanelHierarchyInputEntry>());

        // Assert
        Assert.Empty(result);
    }
}
