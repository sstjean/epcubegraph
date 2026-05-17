using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateDeviceStatusTests
{
    [Fact]
    public void DeviceStatus_Null_ReturnsNull()
    {
        // null is the "use default (active)" case — handled by the store, not a validation failure.
        Assert.Null(Validate.DeviceStatus(null, "status"));
    }

    [Fact]
    public void DeviceStatus_Empty_ReturnsNull()
    {
        // Empty string also maps to default in the store; treat as not-supplied.
        Assert.Null(Validate.DeviceStatus("", "status"));
    }

    [Theory]
    [InlineData("active")]
    [InlineData("removed")]
    [InlineData("merged")]
    [InlineData("all")]
    public void DeviceStatus_KnownValue_ReturnsNull(string status)
    {
        Assert.Null(Validate.DeviceStatus(status, "status"));
    }

    [Theory]
    [InlineData("Active")]    // case-sensitive
    [InlineData("Removed")]
    [InlineData("MERGED")]
    [InlineData("ALL")]
    [InlineData("inactive")]  // not in the allowed set
    [InlineData("pending")]
    [InlineData("xyz")]
    public void DeviceStatus_UnknownOrCaseVariant_ReturnsError(string status)
    {
        var result = Validate.DeviceStatus(status, "status");

        Assert.NotNull(result);
        Assert.Contains("'status'", result);
        Assert.Contains("active", result);
        Assert.Contains("removed", result);
        Assert.Contains("merged", result);
        Assert.Contains("all", result);
    }

    [Fact]
    public void DeviceStatus_Whitespace_ReturnsError()
    {
        // Pure whitespace is not a known value — surface it as a 400 with the allowed list.
        var result = Validate.DeviceStatus("   ", "status");

        Assert.NotNull(result);
        Assert.Contains("'status'", result);
    }
}
