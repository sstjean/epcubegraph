using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreSettingsTests
{
    [Fact]
    public async Task GetAllSettings_ReturnsListIncludingInsertedKeys()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        await store.UpdateSettingAsync("get_all_test_key", "1");

        // Act
        var result = await store.GetAllSettingsAsync();

        // Assert
        Assert.NotNull(result);
        Assert.Contains(result, s => s.Key == "get_all_test_key");
    }

    [Fact]
    public async Task UpdateSetting_CreatesAndReturnsEntry()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var entry = await store.UpdateSettingAsync("create_test_key", "42");

        // Assert
        Assert.Equal("create_test_key", entry.Key);
        Assert.Equal("42", entry.Value);
    }

    [Fact]
    public async Task GetSetting_ReturnsUpdatedValue()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        await store.UpdateSettingAsync("get_test_key", "100");

        // Act
        var entry = await store.GetSettingAsync("get_test_key");

        // Assert
        Assert.NotNull(entry);
        Assert.Equal("100", entry.Value);
    }

    [Fact]
    public async Task GetSetting_ReturnsNullForMissing()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var entry = await store.GetSettingAsync("definitely_nonexistent_key_abc123");

        // Assert
        Assert.Null(entry);
    }

    [Fact]
    public async Task UpdateSetting_OverwritesExistingValue()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());
        await store.UpdateSettingAsync("overwrite_test_key", "10");

        // Act
        var updated = await store.UpdateSettingAsync("overwrite_test_key", "20");

        // Assert
        Assert.Equal("20", updated.Value);
    }
}
