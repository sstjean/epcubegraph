using System.Net;
using System.Net.Http.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;
using EpCubeGraph.Api.Tests.Fixtures;

namespace EpCubeGraph.Api.Tests.Integration;

/// <summary>
/// HTTP-level tests for DELETE /devices/{cloud_id}.
/// </summary>
public class DeleteDeviceEndpointTests
{
    [Fact]
    public async Task DeleteDevice_ReturnsOkWithCounts()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DeleteResult = new DeleteDeviceResponse("5488", 12345);
        using var client = factory.CreateClient();

        // Act
        var response = await client.DeleteAsync("/api/v1/devices/5488");

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DeleteDeviceResponse>();
        Assert.NotNull(body);
        Assert.Equal("5488", body!.DeviceId);
        Assert.Equal(12345, body.ReadingsDeleted);
        Assert.Equal("5488", factory.MockStore.LastDeletedCloudId);
    }

    [Fact]
    public async Task DeleteDevice_Returns404WhenDeviceMissing()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.DeleteResult = null;
        using var client = factory.CreateClient();

        // Act
        var response = await client.DeleteAsync("/api/v1/devices/9999");

        // Assert
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteDevice_Returns422OnInvalidState()
    {
        // Arrange — active device → store throws MergeValidationException
        using var factory = new MockableTestFactory();
        factory.MockStore.ThrowMergeValidation = "Cannot delete an active device";
        using var client = factory.CreateClient();

        // Act
        var response = await client.DeleteAsync("/api/v1/devices/5488");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DeleteDevice_Returns422OnStoreError()
    {
        // Arrange
        using var factory = new MockableTestFactory();
        factory.MockStore.ShouldThrow = true;
        using var client = factory.CreateClient();

        // Act
        var response = await client.DeleteAsync("/api/v1/devices/5488");

        // Assert
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task DeleteDevice_Returns400OnInvalidCloudId()
    {
        // Arrange — non-safe cloud id (contains characters outside [a-z0-9_-])
        using var factory = new MockableTestFactory();
        using var client = factory.CreateClient();

        // Act — slash injection / space etc handled by routing; unsafe chars rejected explicitly
        var response = await client.DeleteAsync("/api/v1/devices/abc%20def");

        // Assert
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
