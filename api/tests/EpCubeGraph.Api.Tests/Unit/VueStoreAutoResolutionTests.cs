using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Tests.Unit;

public class VueStoreAutoResolutionTests
{
    [Theory]
    [InlineData(5, "1s")]        // 5 min → 1s
    [InlineData(30, "1s")]       // 30 min → 1s
    [InlineData(60, "5s")]       // 1 hr → 5s
    [InlineData(120, "5s")]      // 2 hr → 5s
    [InlineData(180, "15s")]     // 3 hr → 15s
    [InlineData(480, "15s")]     // 8 hr → 15s
    [InlineData(720, "1m")]      // 12 hr → 1m
    [InlineData(1440, "1m")]     // 24 hr → 1m
    [InlineData(4320, "5m")]     // 3 days → 5m
    [InlineData(10080, "5m")]    // 7 days → 5m
    [InlineData(20160, "15m")]   // 14 days → 15m
    [InlineData(43200, "15m")]   // 30 days → 15m
    [InlineData(86400, "1h")]    // 60 days → 1h
    [InlineData(129600, "1h")]   // 90 days → 1h
    [InlineData(259200, "4h")]   // 180 days → 4h
    [InlineData(525600, "4h")]   // 365 days → 4h
    public void AutoResolveStep_ReturnsCorrectTier(int rangeMinutes, string expectedStep)
    {
        // Arrange
        var range = TimeSpan.FromMinutes(rangeMinutes);

        // Act
        var result = PostgresVueStore.AutoResolveStep(range);

        // Assert
        Assert.Equal(expectedStep, result);
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

    [Theory]
    [InlineData("1x")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData("s")]
    [InlineData("-1s")]
    [InlineData("0m")]
    public void ParseStep_ThrowsOnInvalidInput(string step)
    {
        // Act & Assert
        Assert.Throws<ArgumentException>(() => PostgresVueStore.ParseStep(step));
    }
}
