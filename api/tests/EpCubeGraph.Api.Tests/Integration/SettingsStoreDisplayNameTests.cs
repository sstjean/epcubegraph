using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreDisplayNameTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public SettingsStoreDisplayNameTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresSettingsStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresSettingsStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetDisplayNames_ReturnsNotNull()
    {
        // Arrange
        var store = await ArrangeStoreAsync();

        // Act
        var result = await store.GetDisplayNamesAsync();

        // Assert
        Assert.NotNull(result);
    }

    [Fact]
    public async Task UpdateDisplayNames_InsertsOverrides()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
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
        var store = await ArrangeStoreAsync();
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
        var store = await ArrangeStoreAsync();
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
        var store = await ArrangeStoreAsync();

        // Act
        var deleted = await store.DeleteDisplayNameAsync(66661, "nonexistent");

        // Assert
        Assert.False(deleted);
    }
}
