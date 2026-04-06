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
        var edges = new List<PanelHierarchyInputEntry>();
        Assert.False(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void SingleEdge_NoCycle()
    {
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
        };
        Assert.False(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void LinearChain_NoCycle()
    {
        // A → B → C (no cycle)
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
        };
        Assert.False(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void SelfReference_DetectedAsCycle()
    {
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 100),
        };
        Assert.True(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void DirectCycle_Detected()
    {
        // A → B → A
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 100),
        };
        Assert.True(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void IndirectCycle_Detected()
    {
        // A → B → C → A
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(200, 300),
            new(300, 100),
        };
        Assert.True(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void DisjointTrees_NoCycle()
    {
        // Two separate trees: A→B, C→D
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(300, 400),
        };
        Assert.False(SettingsEndpoints.HasCycle(edges));
    }

    [Fact]
    public void DiamondShape_NoCycle()
    {
        // A → B, A → C, B → D, C → D (DAG, not a cycle)
        var edges = new List<PanelHierarchyInputEntry>
        {
            new(100, 200),
            new(100, 300),
            new(200, 400),
            new(300, 400),
        };
        Assert.False(SettingsEndpoints.HasCycle(edges));
    }
}
