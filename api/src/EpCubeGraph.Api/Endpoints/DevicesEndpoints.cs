using System.Text.Json;
using EpCubeGraph.Api.Models;
using EpCubeGraph.Api.Services;

namespace EpCubeGraph.Api.Endpoints;

public static class DevicesEndpoints
{
    public static RouteGroupBuilder MapDevicesEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/devices", HandleDevices);
        group.MapGet("/devices/{device}/metrics", HandleDeviceMetrics);

        return group;
    }

    private static async Task<IResult> HandleDevices(
        IVictoriaMetricsClient client,
        IConfiguration config,
        CancellationToken ct)
    {
        JsonElement infoResult;
        JsonElement scrapeResult;

        try
        {
            // Get device info labels from the epcube_device_info metric
            infoResult = await client.SeriesAsync("epcube_device_info", ct: ct);
            scrapeResult = await client.QueryAsync("epcube_scrape_success", ct: ct);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        // Build set of online devices from scrape_success
        var onlineDevices = new HashSet<string>();
        if (scrapeResult.TryGetProperty("data", out var scrapeData) &&
            scrapeData.TryGetProperty("result", out var scrapeResults))
        {
            foreach (var item in scrapeResults.EnumerateArray())
            {
                if (item.TryGetProperty("metric", out var metric) &&
                    metric.TryGetProperty("device", out var deviceProp))
                {
                    var value = item.GetProperty("value")[1].GetString();
                    if (value == "1")
                    {
                        onlineDevices.Add(deviceProp.GetString()!);
                    }
                }
            }
        }

        // Build device list from series info
        var aliases = config.GetSection("DeviceAliases");
        var devices = new List<DeviceInfo>();
        if (infoResult.TryGetProperty("data", out var data))
        {
            foreach (var series in data.EnumerateArray())
            {
                var device = series.GetProperty("device").GetString()!;
                var deviceClass = series.GetProperty("class").GetString()!;

                string? manufacturer = series.TryGetProperty("manufacturer", out var mfr)
                    ? mfr.GetString() : null;
                string? productCode = series.TryGetProperty("product_code", out var pc)
                    ? pc.GetString() : null;
                string? uid = series.TryGetProperty("uid", out var u)
                    ? u.GetString() : null;

                var online = onlineDevices.Contains(device);
                var alias = aliases[device];

                devices.Add(new DeviceInfo(device, deviceClass, manufacturer, productCode, uid, online, alias));
            }
        }

        return Results.Ok(new DeviceListResponse(devices));
    }

    private static async Task<IResult> HandleDeviceMetrics(
        string device,
        IVictoriaMetricsClient client,
        CancellationToken ct)
    {
        var error = Validate.SafeName(device, "device");
        if (error is not null)
            return Results.BadRequest(new ErrorResponse("error", "bad_data", error));

        // Find all series that have this device label
        JsonElement result;
        try
        {
            result = await client.SeriesAsync($"{{device=\"{device}\"}}", ct: ct);
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(
                new ErrorResponse("error", "execution", ex.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        var metrics = new List<string>();
        if (result.TryGetProperty("data", out var data))
        {
            foreach (var series in data.EnumerateArray())
            {
                if (series.TryGetProperty("__name__", out var name))
                {
                    var metricName = name.GetString()!;
                    if (!metrics.Contains(metricName))
                    {
                        metrics.Add(metricName);
                    }
                }
            }
        }

        if (metrics.Count == 0)
        {
            return Results.NotFound(new ErrorResponse("error", "not_found", $"No metrics found for device '{device}'"));
        }

        return Results.Ok(new DeviceMetricsResponse(device, metrics));
    }
}
