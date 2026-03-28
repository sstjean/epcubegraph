using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class PostgresMetricsStoreTests
{
    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var store = new PostgresMetricsStore(
            "Host=localhost;Port=5432;Database=epcubegraph_test;Username=epcube;Password=epcube_test");

        var exception = Record.Exception(store.Dispose);

        Assert.Null(exception);
    }
}