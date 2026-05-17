using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;
using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Integration;

public class SettingsStoreConcurrencyTests
{
    [Fact]
    public async Task ConcurrentEnsureTables_DoesNotThrow()
    {
        // Arrange
        await using var container = await TestSchema.CreateContainerAsync();
        var store = new PostgresSettingsStore(container.GetConnectionString());

        // Act
        var tasks = Enumerable.Range(0, 10)
            .Select(_ => store.GetAllSettingsAsync())
            .ToArray();

        // Assert
        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.NotNull(r));
    }
}
