# Phase 0 Research: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)

> **⚠️ Deprecation Note**: This research was conducted when VictoriaMetrics was the chosen storage backend. VictoriaMetrics is being removed from the project and replaced with Azure SQL Database (serverless). Topics below are retained as historical reference. VictoriaMetrics-specific decisions (vmauth, promscrape, PromQL proxy) no longer apply to the target architecture.

---

## Topic 1: VictoriaMetrics Remote-Write Authentication Proxy

VictoriaMetrics single-node exposes `/api/v1/write` without built-in bearer-token authentication. The spec requires FR-012/FR-013 (bearer token validation on remote-write). An authentication layer must sit in front of VictoriaMetrics on Azure Container Apps.

### Decision

**Use vmauth (VictoriaMetrics auth proxy) as a sidecar container** on Azure Container Apps, configured with bearer-token authentication.

### Rationale

vmauth is the official VictoriaMetrics authentication proxy. It natively supports bearer token validation with zero custom code. The configuration is a single YAML file:

```yaml
users:
- bearer_token: "%{REMOTE_WRITE_TOKEN}"
  url_prefix: "http://localhost:8428/"
```

Key advantages:
- **Native bearer token support**: vmauth validates `Authorization: Bearer <token>` headers out of the box via the `bearer_token` field in its auth config. Requests with missing or incorrect tokens are rejected automatically.
- **Minimal footprint**: vmauth is a single static Go binary (~15 MB), adds negligible latency (<1ms), and uses minimal memory. Ideal for a sidecar in Container Apps.
- **Environment variable substitution**: vmauth config supports `%{ENV_VAR}` placeholders, so the bearer token can be injected from Azure Key Vault → Container Apps secret → environment variable without embedding secrets in config files.
- **Path routing**: vmauth can restrict which paths are accessible (e.g., only `/api/v1/write` for remote-write, `/api/v1/query*` for the API service), providing defense-in-depth.
- **Same ecosystem**: vmauth is part of the VictoriaMetrics project, ensuring protocol compatibility and consistent versioning with VictoriaMetrics and vmagent.
- **Docker image available**: `victoriametrics/vmauth` is published on Docker Hub with multi-arch support.

Architecture on Azure Container Apps:
```
Internet → Container Apps ingress (TLS) → vmauth (:8427) → VictoriaMetrics (:8428)
```
Both vmauth and VictoriaMetrics run in the same Container App as separate containers sharing localhost networking. VictoriaMetrics listens only on localhost (not exposed to ingress), and vmauth is the ingress target.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Azure Container Apps Easy Auth** | Easy Auth supports Entra ID / social IdPs but does not support pre-shared bearer token validation. It would require vmagent to obtain OAuth tokens, which vmagent does not support natively. Adds unnecessary complexity for a machine-to-machine static token use case. |
| **Caddy / nginx sidecar** | Both can validate bearer tokens (Caddy via `header` matcher + `respond`; nginx via `if` + `$http_authorization`). However, they add a non-trivial dependency outside the VictoriaMetrics ecosystem, require custom config for bearer validation, and offer no advantages over vmauth for this specific use case. More moving parts. |
| **Auth built into the C# API service** | The API service could proxy writes to VictoriaMetrics after validating the token. However, this couples the API service to the ingestion path, the API service would need to handle Prometheus remote-write protocol (protobuf + snappy), and it adds latency and a single point of failure. Violates separation of concerns (the API is for downstream query consumers, not ingestion). |
| **VictoriaMetrics `-httpAuth.username`/`-httpAuth.password`** | VictoriaMetrics supports Basic Auth via command-line flags, but not bearer token auth. The spec explicitly requires bearer token (FR-012), and vmagent's `-remoteWrite.bearerToken` flag sends tokens in `Authorization: Bearer` format, not Basic Auth. |

---

## Topic 2: ASP.NET Core + Entra ID (OAuth 2.0) JWT Validation with Scope Enforcement

The API service (FR-010, FR-010a) must validate Entra ID JWT tokens on every request, checking signature, audience, issuer, and expiry, and additionally enforce the `user_impersonation` scope for authorization.

### Decision

**Use `Microsoft.Identity.Web`** — Microsoft's first-party library for Entra ID JWT validation in ASP.NET Core — with policy-based scope enforcement set as the default authorization policy.

### Rationale

`Microsoft.Identity.Web` is the official, Microsoft-maintained library for protecting ASP.NET Core web APIs with Microsoft Entra ID. It is the canonical solution for this exact use case:

```csharp
// Program.cs
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddMicrosoftIdentityWebApiAuthentication(builder.Configuration);

builder.Services.AddAuthorization(options =>
{
    options.DefaultPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireScope("user_impersonation")
        .Build();
});

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

// Protect all /api/v1 endpoints — scope enforced via DefaultPolicy
var api = app.MapGroup("/api/v1").RequireAuthorization();

// Health and metrics endpoints — outside the auth group
app.MapGet("/api/v1/health", ...);  // AllowAnonymous
app.MapMetrics();                    // AllowAnonymous
```

```json
// appsettings.json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<tenant-id>",
    "ClientId": "<app-client-id>",
    "Audience": "api://<app-client-id>"
  }
}
```

Key advantages:
- **First-party Microsoft library**: Maintained by the Microsoft Identity team. Most actively maintained and best-documented option for Entra ID + ASP.NET Core.
- **Automatic JWKS handling**: Fetches and caches the Entra ID OpenID Connect discovery document and JWKS keys on startup. Handles key rotation automatically.
- **Full JWT validation**: Validates signature (RS256), audience (`aud`), issuer (`iss`), expiry (`exp`), and not-before (`nbf`) claims per the Entra ID spec.
- **Scope enforcement**: The `ScopeAuthorizationHandler` checks both `scp` (v2.0) and `http://schemas.microsoft.com/identity/claims/scope` (v1.0) claims. Space-delimited values are split and matched. Missing scope returns HTTP 403 Forbidden (FR-010a).
- **ASP.NET Core-native**: Integrates with the built-in authentication/authorization middleware. One route group with `.RequireAuthorization()` protects all telemetry endpoints.
- **NuGet package**: `Microsoft.Identity.Web` on NuGet — stable, well-versioned, SemVer.

### Scope Enforcement Details

- **Default policy approach**: `RequireScope("user_impersonation")` is set as the `DefaultPolicy` on `AuthorizationOptions`. This means every endpoint using `.RequireAuthorization()` (without a named policy) automatically enforces scope.
- **403 vs 401**: A request with a valid JWT but missing the `user_impersonation` scope receives HTTP 403 Forbidden (not 401). A request with an invalid or expired JWT receives 401.
- **Claim format handling**: `ScopeAuthorizationHandler` checks the `scp` claim (Entra ID v2.0 tokens) and falls back to the full URI form `http://schemas.microsoft.com/identity/claims/scope` (v1.0 tokens). Works with both token versions.
- **`[RequiredScope]` attribute**: Works on controller actions but cannot be applied to Minimal API route groups. Policy-based authorization with `RequireScope` is the only DRY option for Minimal API.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Manual `JwtBearer` middleware** | `AddAuthentication().AddJwtBearer()` with manual JWKS endpoint, issuer, audience, scope configuration. Requires manually handling key rotation, OpenID discovery fetching, and claim validation. `Microsoft.Identity.Web` wraps all of this in a single call. Violates Constitution Principle I (simplicity). |
| **`IdentityServer` / Duende** | Full-featured identity server — far beyond scope for validating incoming tokens from Entra ID. We need a token *validator*, not an identity *provider*. YAGNI. |
| **`MSAL.NET`** | Client-side library for *acquiring* tokens. Does not validate incoming JWT tokens on the server side. Solves a different problem. |
| **`[RequiredScope]` attribute** | Works on controller actions but cannot be applied to Minimal API route groups. Policy-based authorization with `RequireScope` is the only DRY option for Minimal API. |

### Dependencies Impact

The API project's `.csproj` should reference:
- `Microsoft.Identity.Web` (brings in `Microsoft.IdentityModel.Tokens`, `System.IdentityModel.Tokens.Jwt` transitively)
- No additional auth-related packages needed

---

## Topic 3: VictoriaMetrics PromQL Query from C#

The API service (FR-008, FR-009) must query VictoriaMetrics via PromQL for time-range, device, and metric filtering.

### Decision

**Use direct HTTP queries via `HttpClient`** (built-in .NET) to VictoriaMetrics's Prometheus-compatible query API endpoints.

### Rationale

VictoriaMetrics exposes the standard Prometheus HTTP API at:
- `/api/v1/query` — instant queries
- `/api/v1/query_range` — range queries (primary use case for time-series graphing)
- `/api/v1/series` — series metadata
- `/api/v1/labels` and `/api/v1/label/<name>/values` — label discovery

These endpoints return JSON with a well-defined schema. Querying them with `HttpClient` is straightforward:

```csharp
public class VictoriaMetricsClient : IVictoriaMetricsClient
{
    private readonly HttpClient _httpClient;

    public VictoriaMetricsClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<JsonElement> QueryRangeAsync(
        string query, DateTimeOffset start, DateTimeOffset end, string step,
        CancellationToken ct = default)
    {
        var url = $"/api/v1/query_range?query={Uri.EscapeDataString(query)}" +
                  $"&start={start.ToUnixTimeSeconds()}&end={end.ToUnixTimeSeconds()}&step={step}";

        var response = await _httpClient.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var doc = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return doc.RootElement.Clone();
    }
}
```

Registered via DI in `Program.cs`:
```csharp
builder.Services.AddHttpClient<IVictoriaMetricsClient, VictoriaMetricsClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["VictoriaMetrics:Url"]!);
});
```

Key advantages:
- **Zero additional dependencies**: `HttpClient` is built into .NET. No NuGet packages needed for HTTP calls.
- **IHttpClientFactory integration**: ASP.NET Core's `AddHttpClient<T>` provides connection pooling, DNS refresh, and typed client DI — all for free.
- **Full control**: The API service needs to construct PromQL queries with device/metric filters (e.g., `epcube_battery_state_of_capacity_percent{device="epcube_battery"}`). Direct HTTP calls give full control over query construction, timeout handling, and error mapping.
- **Async-native**: `HttpClient` is fully async, consistent with ASP.NET Core's async pipeline.
- **Thin wrapper**: The `VictoriaMetricsClient` class is ~60–80 lines of code covering `QueryAsync`, `QueryRangeAsync`, and `SeriesAsync` — trivially testable by mocking `HttpMessageHandler`.
- **VictoriaMetrics compatibility**: VictoriaMetrics is 100% compatible with the Prometheus HTTP API. No VictoriaMetrics-specific client is needed.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **`PrometheusNet.Client`** (NuGet) | This is the .NET *instrumentation* library (for exposing metrics *from* .NET apps), not a query client. Wrong tool. |
| **`RestSharp`** | Third-party HTTP client. `HttpClient` is built-in and is the recommended approach in .NET 8+. Adding RestSharp would violate YAGNI — `HttpClient` does everything needed. |
| **VictoriaMetrics-specific client** | No official .NET client exists. No well-maintained third-party client was found. The Prometheus HTTP API is the standard interface. |

---

## Topic 4: epcube-exporter — Cloud API Poller

> **Updated 2026-03-16**: Originally researched Docker multi-arch builds for echonet-exporter (a Go-based ECHONET Lite poller). The EP Cube gateways were discovered to have no local protocol support. The system now uses epcube-exporter, a Python-based poller that authenticates with the EP Cube cloud API (monitoring-us.epcube.com) and exposes the same `epcube_*` Prometheus metrics.

### Decision

**Custom Python exporter** that polls the EP Cube cloud API and exposes Prometheus metrics on `:9250/metrics`. Deployed as an Azure Container App with internal-only ingress, scraped directly by VictoriaMetrics via `-promscrape.config`.

### Key Details

- **Authentication**: AJ-Captcha (blockPuzzle) auto-solved via OpenCV contour matching + AES-ECB encryption. Auto-re-authenticates on HTTP 401.
- **Dockerfile**: `python:3.12-slim` + `opencv-python-headless` + `pycryptodome` + `numpy`
- **Deployment**: Built by `infra/deploy.sh`, pushed to ACR, deployed as a Container App
- **Credentials**: EP Cube cloud username/password stored in Azure Key Vault, injected as Container App secrets

---

## Topic 5: VictoriaMetrics Direct Scraping (promscrape)

> **Updated 2026-03-16**: Originally researched vmagent configuration for remote-write with bearer token from a local Docker Compose stack. The ingestion tier now runs entirely in Azure Container Apps, so VictoriaMetrics scrapes epcube-exporter directly — no vmagent intermediary needed.

### Decision

**Use VictoriaMetrics built-in `-promscrape.config`** to scrape the epcube-exporter Container App directly within the Container Apps environment.

### Rationale

Since epcube-exporter runs in the same Container Apps environment as VictoriaMetrics, there is no network boundary to bridge. VictoriaMetrics single-node has built-in Prometheus scraping support via the `-promscrape.config` flag, eliminating the need for vmagent entirely.

```yaml
# promscrape config (generated by Terraform, mounted via init container)
scrape_configs:
  - job_name: epcube
    static_configs:
      - targets: ["<environment_name>-exporter"]
    metrics_path: /metrics
    scrape_interval: 60s
    scrape_timeout: 30s
```

The epcube-exporter Container App has internal-only ingress on port 9250. Within the Container Apps environment, VictoriaMetrics reaches it via `http://<app-name>` (port 80, which maps to target port 9250).

### Notes on vmauth (retained)

vmauth remains as a sidecar in the VictoriaMetrics Container App for external remote-write access. This allows additional metric sources to push data via bearer-token-authenticated HTTPS. The primary epcube-exporter data flow bypasses vmauth entirely (VictoriaMetrics scrapes directly).

---

## Topic 6: Prometheus Self-Monitoring Metrics via prometheus-net

The spec requires the API to expose a `/metrics` endpoint for self-monitoring in Grafana (spec clarification: "Structured logging plus Prometheus health metrics — use ASP.NET Core's built-in `ILogger` with structured JSON output, and expose a `/metrics` endpoint via `prometheus-net` for self-monitoring in Grafana. No distributed tracing."). The plan lists `prometheus-net.AspNetCore` as a primary dependency.

### Decision

**Use `prometheus-net.AspNetCore` v8.2.1** — the official .NET Prometheus instrumentation library with ASP.NET Core middleware for `/metrics` endpoint and HTTP request metrics.

### Rationale

#### Packages Required

Only **one NuGet package** is needed for this project:

| Package | Purpose | Needed? |
|---|---|---|
| **`prometheus-net.AspNetCore`** (v8.2.1) | ASP.NET Core `/metrics` endpoint middleware (`MapMetrics()`) + HTTP request metrics middleware (`UseHttpMetrics()`) + `IHttpClientFactory` metrics. Transitively depends on `prometheus-net` (core library). | **Yes** |
| `prometheus-net` (v8.2.1) | Core library (counters, gauges, histograms, EventCounter/Meters integration, registry). Pulled in automatically by the above. | Transitive — no explicit reference needed |
| `prometheus-net.AspNetCore.Grpc` | gRPC service metrics. | **No** — this API has no gRPC services |
| `prometheus-net.AspNetCore.HealthChecks` | Publishes ASP.NET Core health check results as Prometheus metrics. | **No** — we already have a `/api/v1/health` endpoint; health check metrics add minimal value for a single-user system |

**Current stable version**: **8.2.1** (released January 3, 2024). This is the latest stable release as of early 2026. The library targets .NET 6.0+ and is fully compatible with .NET 8.

#### Program.cs Setup (Minimal API)

```csharp
using Prometheus;

var builder = WebApplication.CreateBuilder(args);

// ... existing service registration (auth, HttpClient, etc.) ...

// Export metrics from all registered HttpClient instances (e.g., VictoriaMetricsClient)
builder.Services.UseHttpClientMetrics();

var app = builder.Build();

// ... existing middleware (UseAuthentication, UseAuthorization) ...

app.UseRouting();

// Capture HTTP request metrics (must be after UseRouting)
app.UseHttpMetrics(options =>
{
    options.ReduceStatusCodeCardinality(); // 200, 201, 204 → 2xx
});

app.UseAuthentication();
app.UseAuthorization();

// Map authenticated API endpoints
var api = app.MapGroup("/api/v1").RequireAuthorization();
// ... endpoint registrations ...

// Map /metrics endpoint — unauthenticated (AllowAnonymous)
app.MapMetrics(); // Defaults to /metrics

app.Run();
```

#### Built-in Metrics Automatically Collected

With `UseHttpMetrics()` and the default configuration, prometheus-net automatically collects:

| Metric Name | Type | Description |
|---|---|---|
| `http_requests_received_total` | Counter | Total HTTP requests received, labeled by `code`, `method`, `controller`, `action` |
| `http_request_duration_seconds` | Histogram | Duration of HTTP requests in seconds (default buckets: 0.001 to 10s) |
| `http_requests_in_progress` | Gauge | Number of HTTP requests currently being processed |

With `UseHttpClientMetrics()` (for outbound calls to VictoriaMetrics):

| Metric Name | Type | Description |
|---|---|---|
| `httpclient_requests_sent_total` | Counter | Total outbound HTTP requests sent via IHttpClientFactory |
| `httpclient_request_duration_seconds` | Histogram | Duration of outbound HTTP client requests |
| `httpclient_requests_in_progress` | Gauge | Outbound HTTP requests currently in progress |

Additionally, **default metrics** are enabled automatically (no code needed):

| Category | Examples |
|---|---|
| **Process metrics** | `process_cpu_seconds_total`, `process_working_set_bytes`, `process_open_handles`, `process_start_time_seconds` |
| **.NET EventCounters** | Well-known .NET EventCounters (GC, threadpool, exception count, etc.) — published by default since v8.0 |
| **.NET Meters** | Any metrics published via the .NET `System.Diagnostics.Metrics` API — captured automatically |

#### Unauthenticated `/metrics` Endpoint

**Yes — the `/metrics` endpoint can be unauthenticated while other endpoints require auth.** This is the standard pattern and is explicitly supported:

```csharp
// Authenticated API endpoints
var api = app.MapGroup("/api/v1").RequireAuthorization();
api.MapGet("/query", QueryEndpoints.Query);
// ...

// Unauthenticated /metrics endpoint (no .RequireAuthorization())
app.MapMetrics(); // Serves Prometheus metrics at /metrics without auth
```

`MapMetrics()` returns a `IEndpointConventionBuilder`, so you can also chain `.RequireAuthorization("PolicyName")` if auth is desired — but for this project, unauthenticated is correct. The `/metrics` endpoint exposes only process/HTTP performance counters, no telemetry data. This aligns with the plan's security note: "Health and metrics endpoints are unauthenticated but expose no telemetry data."

Alternatively, the library supports serving metrics on a **separate port** via `KestrelMetricServer` for network-level isolation, but this is unnecessary for a single-user Container Apps deployment where the `/metrics` endpoint is only accessed by the Grafana instance.

#### Memory/Performance Impact

For a low-traffic single-user API (~28K data points/day, a handful of API queries per day):

- **Memory overhead**: Negligible. The core registry holds metric definitions in memory. With default metrics + HTTP metrics for ~10 endpoints, this is on the order of **tens of KB**. No label cardinality explosion risk at this scale.
- **CPU overhead per request**: Sub-microsecond. Benchmarks show 261M counter increments/second and 105M histogram observations/second. The `UseHttpMetrics()` middleware adds ~1µs per request for updating counters/histograms.
- **Scrape cost**: When Grafana (or any Prometheus-compatible scraper) hits `/metrics`, the library serializes all metrics to Prometheus text format. With ~50–100 metric time series, this takes <1ms and produces ~5–10 KB of text.
- **Package size**: The `prometheus-net.AspNetCore` NuGet is ~55 KB; `prometheus-net` core is ~415 KB. Trivial impact on container image size.
- **No background threads for default metrics**: EventCounter and Meters adapters listen to .NET diagnostic events passively. No polling loops.

**Verdict**: Zero meaningful impact for this project's scale. The library was designed for high-throughput production services; a single-user API will not notice its presence.

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **OpenTelemetry Prometheus Exporter** (`OpenTelemetry.Exporter.Prometheus.AspNetCore`) | The OpenTelemetry SDK is the "standard" for vendor-neutral observability, but for Prometheus-only metrics export it adds significant complexity: requires configuring `MeterProvider`, `AddPrometheusExporter()`, and the OTel SDK pipeline. prometheus-net is simpler (2 lines: `UseHttpMetrics()` + `MapMetrics()`), more performant (10–50x faster per benchmark), and purpose-built for Prometheus. The spec explicitly states "No distributed tracing" — OTel's primary advantage (unified traces + metrics + logs) is unused. For a single-user project exporting to a Prometheus-compatible backend (VictoriaMetrics + Grafana), prometheus-net is the simpler, battle-tested choice. |
| **Custom middleware** (manual `/metrics` endpoint) | Could write a minimal endpoint that exposes `process_cpu_seconds_total` etc. manually. However, this reinvents what prometheus-net does in 2 lines of code, misses HTTP request metrics, requires manual Prometheus text format serialization, and violates Constitution Principle I (simplicity — use existing libraries). YAGNI in reverse: we'd be writing code that already exists. |
| **Application Insights SDK** (`Microsoft.ApplicationInsights.AspNetCore`) | Azure-native APM with rich dashboards. However: (1) the spec explicitly chose Prometheus metrics for Grafana, not Application Insights; (2) App Insights has a per-GB ingestion cost that's disproportionate for a personal project; (3) it doesn't expose a `/metrics` endpoint for Prometheus scraping; (4) it adds significant SDK overhead (telemetry modules, channel, adaptive sampling). Wrong tool for this use case. |
| **No self-monitoring** | Omit `/metrics` entirely. Rejected because the spec explicitly requires it: "expose a `/metrics` endpoint via `prometheus-net` for self-monitoring in Grafana." Minimal cost to include. |

### Dependencies Impact

The API project's `.csproj` should add:
```xml
<PackageReference Include="prometheus-net.AspNetCore" Version="8.2.1" />
```

This transitively includes `prometheus-net` (core). No other prometheus-related packages needed.

### Configuration Notes

- **No configuration file changes needed**: prometheus-net requires no `appsettings.json` entries. It works with zero configuration out of the box.
- **`UseHttpMetrics()` placement**: Must be after `UseRouting()` — it needs routing metadata to label metrics with endpoint/action names. Must be before endpoint mapping so it captures all requests.
- **`ReduceStatusCodeCardinality()`**: Recommended to collapse 200/201/204 → `2xx` to minimize label cardinality. Trivial for this project but good practice.
- **`UseHttpClientMetrics()`**: Registers a `DelegatingHandler` on all `IHttpClientFactory`-created clients. Since the `VictoriaMetricsClient` uses `AddHttpClient<T>()`, its outbound calls to VictoriaMetrics will be automatically instrumented.

---

## Topic 7: Input Validation for ASP.NET Core Minimal API

The API service (FR-019) must validate all incoming request parameters for presence and type, returning HTTP 400 for invalid input.

### Decision

**Use manual inline validation with shared static helper methods** and `TypedResults.BadRequest()` for error responses.

### Rationale

For ~9 endpoints with 4 validation types (required string, timestamp, duration, safe name), a lightweight approach is simplest:

```csharp
// Validate.cs — shared static helpers
public static class Validate
{
    public static string? Required(string? value, string paramName)
        => string.IsNullOrWhiteSpace(value) ? $"'{paramName}' is required" : null;

    public static string? Timestamp(string? value, string paramName)
    {
        if (value is null) return null; // optional
        if (long.TryParse(value, out _)) return null; // Unix epoch
        if (DateTimeOffset.TryParse(value, out _)) return null; // RFC3339
        return $"'{paramName}' must be a valid RFC3339 timestamp or Unix epoch";
    }

    public static string? Duration(string? value, string paramName)
    {
        if (value is null) return null; // optional
        if (System.Text.RegularExpressions.Regex.IsMatch(value, @"^\d+[smhd]$"))
            return null;
        return $"'{paramName}' must be a valid duration (e.g., 1m, 5m, 1h, 1d)";
    }

    public static string? SafeName(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"'{paramName}' is required";
        if (System.Text.RegularExpressions.Regex.IsMatch(value, @"^[a-zA-Z_][a-zA-Z0-9_]*$"))
            return null;
        return $"'{paramName}' contains invalid characters";
    }
}
```

Usage in endpoints:
```csharp
app.MapGet("/api/v1/query", (string? query, string? time) =>
{
    if (Validate.Required(query, "query") is string err)
        return Results.BadRequest(new { status = "error", errorType = "bad_data", error = err });
    if (Validate.Timestamp(time, "time") is string tErr)
        return Results.BadRequest(new { status = "error", errorType = "bad_data", error = tErr });

    // ... proceed with valid params
});
```

Error response format (matches Prometheus error envelope):
```csharp
// ErrorResponse.cs
public record ErrorResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("errorType")] string ErrorType,
    [property: JsonPropertyName("error")] string Error);
```

Key advantages:
- **Zero dependencies**: No NuGet packages. Pure static methods on a single class.
- **Trivially testable**: Each method is a pure function — input string, output error string or null. Unit tests are one-liners.
- **Consistent error format**: Matches the Prometheus error response envelope (`status`, `errorType`, `error`), so clients have one error-handling path.
- **Explicit and readable**: Validation is visible in each endpoint handler — no magic, no attribute scanning, no middleware chain.

### Files

| File | Purpose |
|---|---|
| `Validate.cs` | Static helpers: `Required`, `Timestamp`, `Duration`, `SafeName` |
| `ErrorResponse.cs` | Shared error response record matching Prometheus envelope |
| `ValidateTests.cs` | Unit tests for all 4 validation methods (100% coverage) |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **`[AsParameters]` + Data Annotations** | Poor Minimal API query string support. Custom `ValidationAttribute` still needed for timestamps/durations. Can't control error response format. |
| **FluentValidation** | External dependency. Validator classes for 4 check functions. Requires extra wiring for Minimal API (`AddFluentValidation`, endpoint filters). Over-engineered for this scale. |
| **Custom `IEndpointFilter`** | Type-unsafe `context.Arguments` indexing. Abstracting validation away from endpoints adds indirection. Not justified for ~9 endpoints. |
| **MiniValidation** | Annotation-driven. Doesn't solve timestamp/duration validation without custom attributes. Same drawbacks as Data Annotations. |

---

## Summary of Decisions

| # | Topic | Decision | Key Dependency |
|---|---|---|---|
| 1 | Remote-write auth proxy | vmauth sidecar with bearer token config | `victoriametrics/vmauth` Docker image |
| 2 | ASP.NET Core + Entra ID JWT + scope | `Microsoft.Identity.Web` with `RequireScope("user_impersonation")` default policy | `Microsoft.Identity.Web` (NuGet) |
| 3 | PromQL queries from C# | Direct `HttpClient` async client (~70 LOC) | `HttpClient` (built-in .NET) |
| 4 | epcube-exporter cloud API poller | Custom Python exporter deployed as Azure Container App | `python:3.12-slim` + `opencv-python-headless` + `pycryptodome` |
| 5 | VictoriaMetrics direct scraping | `-promscrape.config` within Container Apps environment | VictoriaMetrics built-in (no vmagent needed) |
| 6 | Prometheus self-monitoring | `prometheus-net.AspNetCore` v8.2.1 (2-line setup) | `prometheus-net.AspNetCore` (NuGet) |
| 7 | Input validation | Static `Validate` helper class with 4 methods | None (built-in .NET) |
