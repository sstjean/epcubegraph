using EpCubeGraph.Api;

namespace EpCubeGraph.Api.Tests.Unit;

public class ValidateRequiredTests
{
    [Fact]
    public void Required_Null_ReturnsError()
    {
        var result = Validate.Required(null, "query");

        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Empty_ReturnsError()
    {
        var result = Validate.Required("", "query");

        Assert.NotNull(result);
        Assert.Contains("'query' is required", result);
    }

    [Fact]
    public void Required_Whitespace_ReturnsError()
    {
        var result = Validate.Required("   ", "query");

        Assert.NotNull(result);
    }

    [Fact]
    public void Required_ValidValue_ReturnsNull()
    {
        var result = Validate.Required("up", "query");

        Assert.Null(result);
    }

    [Fact]
    public void Required_TabCharacter_ReturnsError()
    {
        var result = Validate.Required("\t", "query");

        Assert.NotNull(result);
    }

    [Fact]
    public void Required_NewlineOnly_ReturnsError()
    {
        var result = Validate.Required("\n", "query");

        Assert.NotNull(result);
    }

    [Fact]
    public void Required_MixedWhitespace_ReturnsError()
    {
        var result = Validate.Required(" \t\n ", "query");

        Assert.NotNull(result);
    }
}
