using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;

namespace EpCubeGraph.Api.Tests.Fixtures;

public class VictoriaMetricsFixture : IAsyncLifetime
{
    private readonly IContainer _container;

    public VictoriaMetricsFixture()
    {
        _container = new ContainerBuilder()
            .WithImage("victoriametrics/victoria-metrics:v1.106.1")
            .WithPortBinding(8428, true)
            .WithCommand(
                "-retentionPeriod=5y",
                "-dedup.minScrapeInterval=1m",
                "-search.maxPointsPerTimeseries=50000",
                "-storageDataPath=/victoria-metrics-data")
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(8428).ForPath("/health")))
            .Build();
    }

    public string BaseUrl => $"http://{_container.Hostname}:{_container.GetMappedPublicPort(8428)}";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }
}
