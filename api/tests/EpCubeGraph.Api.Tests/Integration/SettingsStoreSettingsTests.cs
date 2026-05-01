using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreSettingsTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public SettingsStoreSettingsTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<PostgresSettingsStore> ArrangeStoreAsync()
    {
        await _fixture.ClearDataAsync();
        return new PostgresSettingsStore(_fixture.ConnectionString);
    }

    [Fact]
    public async Task GetAllSettings_ReturnsListIncludingInsertedKeys()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
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
        var store = await ArrangeStoreAsync();

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
        var store = await ArrangeStoreAsync();
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
        var store = await ArrangeStoreAsync();

        // Act
        var entry = await store.GetSettingAsync("definitely_nonexistent_key_abc123");

        // Assert
        Assert.Null(entry);
    }

    [Fact]
    public async Task UpdateSetting_OverwritesExistingValue()
    {
        // Arrange
        var store = await ArrangeStoreAsync();
        await store.UpdateSettingAsync("overwrite_test_key", "10");

        // Act
        var updated = await store.UpdateSettingAsync("overwrite_test_key", "20");

        // Assert
        Assert.Equal("20", updated.Value);
    }
}
