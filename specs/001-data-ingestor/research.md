# Phase 0 Research: EP Cube Telemetry Data Ingestor

**Branch**: `001-data-ingestor` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)

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
- **Full control**: The API service needs to construct PromQL queries with device/metric filters (e.g., `echonet_battery_state_of_capacity_percent{device="epcube_battery"}`). Direct HTTP calls give full control over query construction, timeout handling, and error mapping.
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

## Topic 4: Docker Multi-Arch Builds for echonet-exporter

echonet-exporter is a Go binary that must run on AMD64 (NAS) and ARM64 (Raspberry Pi) per FR-015 and the spec assumptions.

### Decision

**Use Docker buildx with Go cross-compilation** (`GOOS`/`GOARCH`) in a multi-stage Dockerfile. Base image: `alpine:3.19` (or latest stable).

### Rationale

Go has first-class cross-compilation support. Combined with Docker buildx's `--platform` flag and BuildKit's pre-defined `BUILDPLATFORM`/`TARGETOS`/`TARGETARCH` args, a single Dockerfile produces multi-arch images without QEMU emulation:

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /echonet-exporter ./cmd/echonet-exporter

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /echonet-exporter /usr/local/bin/echonet-exporter
EXPOSE 9191
ENTRYPOINT ["echonet-exporter"]
```

Build command:
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/styygeli/echonet-exporter:latest --push .
```

Key advantages:
- **Native-speed builds**: Go cross-compiles natively — no QEMU emulation needed for the compilation step. Only the final `alpine` stage needs multi-arch support (which Alpine provides natively).
- **`CGO_ENABLED=0`**: echonet-exporter is pure Go (UDP networking, HTTP server). Static binary with no C dependencies, so cross-compilation works perfectly.
- **Small image**: Alpine base (~7 MB) + static Go binary (~10–15 MB). Total image ~20 MB.
- **`ca-certificates` + `tzdata`**: Included for HTTPS (if needed for future features) and correct timezone handling for UTC normalization (FR-011).
- **`-ldflags="-s -w"`**: Strips debug symbols, reducing binary size by ~30%.

### Base Image Choice

| Option | Size | Why Chosen/Rejected |
|---|---|---|
| **`alpine:3.19`** | ~7 MB | **Chosen**. Minimal, multi-arch (amd64, arm64, arm/v7), well-maintained, includes `apk` for adding `ca-certificates` and `tzdata`. |
| **`scratch`** | 0 MB | Rejected. No shell for debugging, no `ca-certificates` (need to copy from builder), no timezone data. Marginal size savings (~7 MB) not worth the debuggability trade-off for an IoT edge device. |
| **`distroless`** | ~20 MB | Rejected. Larger than alpine, no shell for debugging, Google-maintained (not Alpine ecosystem). |
| **`debian:bookworm-slim`** | ~80 MB | Rejected. Unnecessarily large for a static Go binary. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **QEMU emulation (no cross-compilation)** | Docker buildx supports QEMU for emulating arm64 on amd64 hosts. However, QEMU-emulated Go compilation is 5–10x slower than native cross-compilation. For a project with regular CI builds, this wastes significant time. Go's built-in cross-compilation eliminates the need for QEMU entirely. |
| **Separate Dockerfiles per arch** | Maintainability nightmare. The multi-stage cross-compilation approach produces a single Dockerfile for all platforms. |
| **Pre-built binaries (no Docker build)** | The spec (FR-015) requires Dockerfiles in the repo. The image must be buildable from source via `docker compose build` (FR-018). |

---

## Topic 5: vmagent Configuration for Remote-Write with Bearer Token

vmagent must include a bearer token in the `Authorization` header when remote-writing to the Azure-hosted VictoriaMetrics endpoint (FR-012, FR-016).

### Decision

**Use the `-remoteWrite.bearerToken` command-line flag** (or `-remoteWrite.bearerTokenFile` for file-based injection), configured via environment variable in Docker Compose.

### Rationale

vmagent has built-in, first-class support for bearer token authentication on remote-write. The relevant flags are:

```
-remoteWrite.bearerToken array
    Optional bearer auth token to use for the corresponding -remoteWrite.url

-remoteWrite.bearerTokenFile array
    Optional path to bearer token file to use for the corresponding -remoteWrite.url.
    The token is re-read from the file every second
```

When `-remoteWrite.bearerToken=MY_TOKEN` is set, vmagent automatically sends:
```
Authorization: Bearer MY_TOKEN
```
with every remote-write request to the corresponding `-remoteWrite.url`.

Docker Compose configuration:
```yaml
services:
  vmagent:
    image: victoriametrics/vmagent:v1.106.1
    command:
      - "-promscrape.config=/etc/vmagent/scrape.yml"
      - "-remoteWrite.url=${REMOTE_WRITE_URL}"
      - "-remoteWrite.bearerToken=${REMOTE_WRITE_TOKEN}"
      - "-remoteWrite.tmpDataPath=/vmagent-data"
      - "-remoteWrite.maxDiskUsagePerURL=1GB"
    env_file: .env
    volumes:
      - ./vmagent/scrape.yml:/etc/vmagent/scrape.yml:ro
      - vmagent-data:/vmagent-data
    restart: unless-stopped
```

`.env` file:
```bash
REMOTE_WRITE_URL=https://epcubegraph-vm.azurecontainerapps.io/api/v1/write
REMOTE_WRITE_TOKEN=<token-from-key-vault>
```

### Key Configuration Details

| Flag | Purpose | Notes |
|---|---|---|
| `-remoteWrite.bearerToken` | Injects bearer token in Authorization header | Supports `%{ENV_VAR}` substitution in command-line args. Can also use env var directly via Docker Compose `command:` interpolation. |
| `-remoteWrite.bearerTokenFile` | Reads token from a file, re-reads every second | Useful for token rotation without container restart. File can be mounted via Docker secret or volume. |
| `-remoteWrite.tmpDataPath` | WAL (write-ahead log) directory for buffering | Essential for SC-002 (zero data loss during Azure outages). Must be a persistent volume. |
| `-remoteWrite.maxDiskUsagePerURL` | Maximum WAL size | Prevents disk exhaustion on the Docker host. 1 GB is sufficient for days of buffering at ~28K points/day. |
| `-remoteWrite.headers` | Custom HTTP headers | Alternative to `-remoteWrite.bearerToken`. Can set `Authorization: Bearer <token>` directly: `-remoteWrite.headers='Authorization: Bearer MY_TOKEN'`. Less ergonomic but equivalent. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **`-remoteWrite.headers`** | Functionally equivalent (`-remoteWrite.headers='Authorization: Bearer TOKEN'`) but less idiomatic. The dedicated `-remoteWrite.bearerToken` flag is clearer in intent and masks the token value in logs/metrics by default (vmagent hides `-remoteWrite.url` secrets). |
| **`-remoteWrite.basicAuth.*`** | Sends Basic Auth header, not Bearer token. vmauth on the Azure side is configured for bearer token validation, not Basic Auth. Protocol mismatch. |
| **`-remoteWrite.oauth2.*`** | vmagent supports OAuth2 client-credentials flow (`-remoteWrite.oauth2.clientID`, `-remoteWrite.oauth2.clientSecret`, `-remoteWrite.oauth2.tokenUrl`). This would allow vmagent to obtain short-lived tokens from Entra ID. However, this adds significant complexity (Entra app registration for vmagent, token endpoint configuration) for a single-user system where a pre-shared token is sufficient. Noted in the plan's Complexity Tracking as a justified exception. |
| **`-remoteWrite.bearerTokenFile` as primary** | Better for token rotation (re-reads every second). However, for Docker Compose on an edge device, injecting via environment variable is simpler. Can be switched to file-based if rotation policy requires it later. YAGNI for now. |

### Scrape Configuration

The vmagent scrape config (`scrape.yml`) for echonet-exporter:

```yaml
scrape_configs:
  - job_name: echonet
    static_configs:
      - targets: ["echonet-exporter:9191"]
    metrics_path: /metrics
    scrape_interval: 60s
    scrape_timeout: 30s
```

Note: `echonet-exporter` is resolved via Docker Compose service name networking. The scrape interval aligns with echonet-exporter's detached scraping (default 1-minute interval).

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
| 4 | Docker multi-arch builds | `docker buildx` + Go cross-compilation, `alpine:3.19` base | `golang:1.22-alpine` (build), `alpine:3.19` (runtime) |
| 5 | vmagent bearer token | `-remoteWrite.bearerToken` flag via env var | `victoriametrics/vmagent` Docker image |
| 6 | Prometheus self-monitoring | `prometheus-net.AspNetCore` v8.2.1 (2-line setup) | `prometheus-net.AspNetCore` (NuGet) |
| 7 | Input validation | Static `Validate` helper class with 4 methods | None (built-in .NET) |
