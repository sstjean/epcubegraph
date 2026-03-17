using System.Text.Json;
using EpCubeGraph.Api;
using EpCubeGraph.Api.Endpoints;
using EpCubeGraph.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Identity.Web;
using Prometheus;

var builder = WebApplication.CreateBuilder(args);

// Structured JSON logging (T042)
builder.Logging.AddJsonConsole();

// Authentication & Authorization
var disableAuth = string.Equals(builder.Configuration["Authentication:DisableAuth"], "true", StringComparison.OrdinalIgnoreCase)
    || string.Equals(Environment.GetEnvironmentVariable("EPCUBE_DISABLE_AUTH"), "true", StringComparison.OrdinalIgnoreCase);
if (builder.Environment.IsDevelopment() && disableAuth)
{
    // Local development: skip Entra ID, allow all requests
    builder.Services.AddAuthentication("NoAuth")
        .AddScheme<AuthenticationSchemeOptions, NoAuthHandler>("NoAuth", null);
    builder.Services.AddAuthorization();
}
else
{
    // Production: Entra ID JWT validation (T006)
    builder.Services
        .AddMicrosoftIdentityWebApiAuthentication(builder.Configuration);

    // Require user_impersonation scope as default policy (T006)
    builder.Services.AddAuthorization(options =>
    {
        options.DefaultPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireScope("user_impersonation")
            .Build();
    });
}

// Service registration (T031)
builder.Services
    .AddHttpClient<IVictoriaMetricsClient, VictoriaMetricsClient>(client =>
    {
        var url = builder.Configuration["VictoriaMetrics:Url"] ?? "http://localhost:8428";
        client.BaseAddress = new Uri(url);
    });
builder.Services.AddScoped<GridCalculator>();

// JSON serialization — camelCase (T009)
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

// Swagger/OpenAPI (T009)
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Global error handling (T009)
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler(appBuilder =>
    {
        appBuilder.Run(async context =>
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                status = "error",
                errorType = "internal",
                error = "An unexpected error occurred"
            });
        });
    });
}

// Swagger (development only) (T009)
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Prometheus HTTP metrics middleware (T041)
app.UseHttpMetrics();

// Auth middleware (T006)
app.UseAuthentication();
app.UseAuthorization();

// Prometheus /metrics endpoint — unauthenticated, outside /api/v1 (T041)
app.MapMetrics().AllowAnonymous();

// API v1 route group — authenticated endpoints (T031)
var v1 = app.MapGroup("/api/v1");
v1.RequireAuthorization();

v1.MapHealthEndpoints();
v1.MapQueryEndpoints();
v1.MapDevicesEndpoints();
v1.MapGridEndpoints();

app.Run();

// Make Program accessible for WebApplicationFactory integration tests
public partial class Program { }

