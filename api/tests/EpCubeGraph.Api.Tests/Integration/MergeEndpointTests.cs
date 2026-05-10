using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

public class MergeEndpointTests : IClassFixture<MockableTestFactory>, IDisposable
{
    private readonly MockableTestFactory _factory;
    private readonly HttpClient _client;

    public MergeEndpointTests(MockableTestFactory factory)
    {
        _factory = factory;
        _factory.MockStore.Reset();
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
    }

    // ── GET /devices/merge-preview ──

    [Fact]
    public async Task GetMergePreview_ReturnsCountsFromStore()
    {
        // Arrange
        _factory.MockStore.MergePreviewResult = new MergePreviewResponse("100", "200", 1234, 5);

        // Act
        var response = await _client.GetAsync("/api/v1/devices/merge-preview?old_device_id=100&new_device_id=200");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<MergePreviewResponse>();
        Assert.NotNull(body);
        Assert.Equal("100", body.OldDeviceId);
        Assert.Equal("200", body.NewDeviceId);
        Assert.Equal(1234, body.ReadingsToTransfer);
        Assert.Equal(5, body.ConflictsToSkip);
    }

    [Fact]
    public async Task GetMergePreview_Returns404WhenDevicesUnknown()
    {
        // Arrange — store returns null
        _factory.MockStore.MergePreviewResult = null;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/merge-preview?old_device_id=999&new_device_id=888");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetMergePreview_Returns422OnInvalidState()
    {
        // Arrange — wrong-status validation error
        _factory.MockStore.ThrowMergeValidation = "Old device must be in 'removed' status";

        // Act
        var response = await _client.GetAsync("/api/v1/devices/merge-preview?old_device_id=100&new_device_id=200");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task GetMergePreview_Returns400WhenMissingQueryParams()
    {
        // Arrange — no params

        // Act
        var response = await _client.GetAsync("/api/v1/devices/merge-preview");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetMergePreview_Returns422OnStoreError()
    {
        // Arrange
        _factory.MockStore.ShouldThrow = true;

        // Act
        var response = await _client.GetAsync("/api/v1/devices/merge-preview?old_device_id=100&new_device_id=200");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // ── POST /devices/merge ──

    [Fact]
    public async Task PostMerge_ReturnsResponseFromStore()
    {
        // Arrange
        _factory.MockStore.MergeResult = new MergeResponse("100", "200", 4321, 7);

        // Act
        var response = await _client.PostAsJsonAsync("/api/v1/devices/merge",
            new MergeRequest("100", "200"));

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<MergeResponse>();
        Assert.NotNull(body);
        Assert.Equal(4321, body.ReadingsTransferred);
        Assert.Equal(7, body.ConflictsSkipped);
        Assert.Equal(("100", "200"), _factory.MockStore.LastMergeArgs);
    }

    [Fact]
    public async Task PostMerge_Returns404WhenDevicesUnknown()
    {
        // Arrange
        _factory.MockStore.MergeResult = null;

        // Act
        var response = await _client.PostAsJsonAsync("/api/v1/devices/merge",
            new MergeRequest("999", "888"));

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PostMerge_Returns422OnInvalidState()
    {
        // Arrange
        _factory.MockStore.ThrowMergeValidation = "Cannot merge: new device is not active";

        // Act
        var response = await _client.PostAsJsonAsync("/api/v1/devices/merge",
            new MergeRequest("100", "200"));

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task PostMerge_Returns400WhenBodyMissing()
    {
        // Act
        var response = await _client.PostAsJsonAsync<MergeRequest?>("/api/v1/devices/merge", null);

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostMerge_Returns400WhenIdsBlank()
    {
        // Act
        var response = await _client.PostAsJsonAsync("/api/v1/devices/merge",
            new MergeRequest("", ""));

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PostMerge_Returns422OnStoreError()
    {
        // Arrange
        _factory.MockStore.ShouldThrow = true;

        // Act
        var response = await _client.PostAsJsonAsync("/api/v1/devices/merge",
            new MergeRequest("100", "200"));

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
