using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class VueStoreStepResolutionTests
{
    [Theory]
    [InlineData(10, "1s")]
    [InlineData(30, "1s")]
    [InlineData(60, "5s")]
    [InlineData(120, "5s")]
    [InlineData(300, "15s")]
    [InlineData(480, "15s")]
    [InlineData(720, "1m")]
    [InlineData(1440, "1m")]
    [InlineData(4320, "5m")]
    [InlineData(10080, "5m")]
    [InlineData(20160, "15m")]
    [InlineData(43200, "15m")]
    [InlineData(86400, "1h")]
    [InlineData(129600, "1h")]
    [InlineData(259200, "4h")]
    public void AutoResolveStep_ReturnsCorrectTier(int minutes, string expected)
    {
        // Act
        var result = PostgresVueStore.AutoResolveStep(TimeSpan.FromMinutes(minutes));

        // Assert
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("1s", 1)]
    [InlineData("5s", 5)]
    [InlineData("15s", 15)]
    [InlineData("1m", 60)]
    [InlineData("5m", 300)]
    [InlineData("15m", 900)]
    [InlineData("1h", 3600)]
    [InlineData("4h", 14400)]
    public void ParseStep_ReturnsCorrectTimeSpan(string step, int expectedSeconds)
    {
        // Act
        var result = PostgresVueStore.ParseStep(step);

        // Assert
        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), result);
    }

    [Fact]
    public void ParseStep_ThrowsOnInvalidInput()
    {
        // Act & Assert
        Assert.Throws<ArgumentException>(() => PostgresVueStore.ParseStep("1x"));
    }
}
