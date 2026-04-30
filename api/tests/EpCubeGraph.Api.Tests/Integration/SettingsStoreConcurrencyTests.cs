using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreConcurrencyTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _fixture;

    public SettingsStoreConcurrencyTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task ConcurrentEnsureTables_DoesNotThrow()
    {
        // Arrange
        await _fixture.ClearDataAsync();
        var store = new PostgresSettingsStore(_fixture.ConnectionString);

        // Act
        var tasks = Enumerable.Range(0, 10)
            .Select(_ => store.GetAllSettingsAsync())
            .ToArray();

        // Assert
        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.NotNull(r));
    }
}
