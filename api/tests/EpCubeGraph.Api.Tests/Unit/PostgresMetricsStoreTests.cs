using EpCubeGraph.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace EpCubeGraph.Api.Tests.Unit;

public class PostgresMetricsStoreTests
{
    [Fact]
    public void Dispose_DoesNotThrow()
    {
        var store = new PostgresMetricsStore(
            "Host=localhost;Port=5432;Database=epcubegraph_test;Username=epcube;Password=epcube_test",
            NullLogger<PostgresMetricsStore>.Instance);

        var exception = Record.Exception(store.Dispose);

        Assert.Null(exception);
    }
}