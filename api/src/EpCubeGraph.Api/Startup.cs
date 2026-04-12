using Microsoft.Extensions.Configuration;

namespace EpCubeGraph.Api;

public static class Startup
{
    public static string GetRequiredConnectionString(IConfiguration configuration)
    {
        return configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection is required. Set it in appsettings.json or environment.");
    }
}
