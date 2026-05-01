using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class PostgresSettingsStoreTests
{
    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var store = new PostgresSettingsStore(
            "Host=localhost;Port=5432;Database=epcubegraph_test;Username=epcube;Password=epcube_test");

        var exception = Record.Exception(store.Dispose);

        Assert.Null(exception);
    }
}
