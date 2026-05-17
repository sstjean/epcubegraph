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

    [Fact]
    public void MergeCommandTimeoutSeconds_IsGenerousEnoughForRealisticData()
    {
        // Regression test: Npgsql's default CommandTimeout (30s) is too short for
        // merging the readings of a long-lived device (~475k rows observed in staging
        // mirrored from production). Reverting this constant to the default would
        // re-introduce the timeout failure observed at staging 2026-05-17 19:49 UTC.
        // 5 minutes is the floor at which a single-pass UPDATE/DELETE across hundreds
        // of thousands of rows reliably completes on Azure Postgres Flexible Server.
        Assert.True(
            PostgresMetricsStore.MergeCommandTimeoutSeconds >= 300,
            $"MergeCommandTimeoutSeconds={PostgresMetricsStore.MergeCommandTimeoutSeconds}s is too short; expected >= 300s");
    }
}