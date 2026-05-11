using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreHierarchyTests
{
    [Fact]
    public async Task GetHierarchy_ReturnsNotNull()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var result = await store.GetHierarchyAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateHierarchy_InsertsAndReturnsEntries()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
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
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
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
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
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
