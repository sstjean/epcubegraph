using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreDisplayNameTests
{
    [Fact]
    public async Task GetDisplayNames_ReturnsNotNull()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var result = await store.GetDisplayNamesAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateDisplayNames_InsertsOverrides()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        var overrides = new List<DisplayNameInputEntry>
        {
            new(null, "Main Panel"),
            new("1", "Kitchen"),
        };

        // Act
        var result = await store.UpdateDisplayNamesForDeviceAsync(99991, overrides);

        // Assert
        Assert.Equal(2, result.Count);
        Assert.Contains(result, o => o.DisplayName == "Main Panel" && o.ChannelNumber == null);
        Assert.Contains(result, o => o.DisplayName == "Kitchen" && o.ChannelNumber == "1");
    }

    [Fact]
    public async Task UpdateDisplayNames_ReplacesForDevice()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        await store.UpdateDisplayNamesForDeviceAsync(88881, new List<DisplayNameInputEntry>
        {
            new("1", "Old Name"),
        });

        // Act
        var result = await store.UpdateDisplayNamesForDeviceAsync(88881, new List<DisplayNameInputEntry>
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
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        await store.UpdateDisplayNamesForDeviceAsync(77771, new List<DisplayNameInputEntry>
        {
            new("5", "To Delete"),
        });

        // Act
        var deleted = await store.DeleteDisplayNameAsync(77771, "5");

        // Assert
        Assert.True(deleted);
    }

    [Fact]
    public async Task DeleteDisplayName_ReturnsFalseWhenNotFound()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var deleted = await store.DeleteDisplayNameAsync(66661, "nonexistent");

        // Assert
        Assert.False(deleted);
    }
}
