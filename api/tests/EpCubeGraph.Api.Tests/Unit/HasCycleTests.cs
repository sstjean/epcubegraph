using EpCubeGraph.Api.Endpoints;
using EpCubeGraph.Api.Models;

namespace EpCubeGraph.Api.Tests.Unit;

/// <summary>
/// Unit tests for SettingsEndpoints.HasCycle — DFS-based cycle detection
/// in panel hierarchy parent→child edges.
/// </summary>
public class HasCycleTests
{
    [Fact]
    public void EmptyEdges_NoCycle()
    {
        // Arrange
        var edges = new List<PanelHierarchyInputEntry>();

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void SingleEdge_NoCycle()
    {
        // Arrange
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void LinearChain_NoCycle()
    {
        // Arrange — A → B → C (no cycle)
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void SelfReference_DetectedAsCycle()
    {
        // Arrange
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 100),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.True(result);
    }

    [Fact]
    public void DirectCycle_Detected()
    {
        // Arrange — A → B → A
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 100),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.True(result);
    }

    [Fact]
    public void IndirectCycle_Detected()
    {
        // Arrange — A → B → C → A
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
            new(300, 100),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.True(result);
    }

    [Fact]
    public void DisjointTrees_NoCycle()
    {
        // Arrange — Two separate trees: A→B, C→D
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(300, 400),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void DiamondShape_NoCycle()
    {
        // Arrange — A → B, A → C, B → D, C → D (DAG, not a cycle)
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 300),
            new(200, 400),
            new(300, 400),
        };

        // Act
        var result = SettingsEndpoints.HasCycle(edges);

        // Assert
        Assert.False(result);
    }
}
