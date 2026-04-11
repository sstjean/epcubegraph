using System.Text.Json;
using EpCubeGraph.Api;
using EpCubeGraph.Api.Endpoints;
using EpCubeGraph.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.Options;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Structured JSON logging
builder.Logging.AddJsonConsole();

// Authentication & Authorization
var disableAuth = string.Equals(builder.Configuration["Authentication:DisableAuth"], "true", StringComparison.OrdinalIgnoreCase)
    || string.Equals(Environment.GetEnvironmentVariable("EPCUBE_DISABLE_AUTH"), "true", StringComparison.OrdinalIgnoreCase);
if (builder.Environment.IsDevelopment() && disableAuth)
{
    builder.Services.AddAuthentication("NoAuth")
        .AddScheme<AuthenticationSchemeOptions, NoAuthHandler>("NoAuth", null);
    builder.Services.AddAuthorization();
}
else
{
    builder.Services
        .AddMicrosoftIdentityWebApiAuthentication(builder.Configuration);

    builder.Services.AddAuthorization(options =>
    {
        options.DefaultPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireScope("user_impersonation")
            .Build();
    });
}

// PostgreSQL data store
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Host=localhost;Port=5432;Database=epcubegraph;Username=epcube;Password=epcube_local";
builder.Services.AddSingleton<IMetricsStore>(new PostgresMetricsStore(connectionString));
builder.Services.AddSingleton<ISettingsStore>(new PostgresSettingsStore(connectionString));
builder.Services.AddSingleton<IVueStore>(new PostgresVueStore(connectionString));

// CORS
builder.Services.AddCors();

// JSON serialization — camelCase
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

// Swagger/OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Global error handling
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler(appBuilder =>
    {
        appBuilder.Run(async context =>
        {
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("UnhandledException");
            var exceptionFeature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
            if (exceptionFeature?.Error is not null)
            {
                logger.LogError(exceptionFeature.Error, "Unhandled exception on {Method} {Path}",
                    context.Request.Method, context.Request.Path);
            }
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                status = "error",
                errorType = "internal",
                error = "An unexpected error occurred while processing the request"
            });
        });
    });
}

// Swagger (development only)
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// CORS
var allowedOrigin = app.Configuration["Cors:AllowedOrigin"];
if (!string.IsNullOrEmpty(allowedOrigin))
{
    var corsOptions = app.Services.GetRequiredService<IOptions<CorsOptions>>();
    corsOptions.Value.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigin)
              .WithMethods("GET", "PUT", "DELETE")
              .WithHeaders("Authorization", "Content-Type");
    });
    app.UseCors();
}

// Auth middleware
app.UseAuthentication();
app.UseAuthorization();

// API v1 route group — authenticated endpoints
var v1 = app.MapGroup("/api/v1");
v1.RequireAuthorization();

v1.MapHealthEndpoints();
v1.MapReadingsEndpoints();
v1.MapDevicesEndpoints();
v1.MapGridEndpoints();
v1.MapSettingsEndpoints();
v1.MapVueEndpoints();

app.Run();

// Make Program accessible for WebApplicationFactory integration tests
public partial class Program { }

