# Research: Input Validation for ASP.NET Core 8 Minimal API

> **⚠️ Note**: Some validation rules reference PromQL query syntax. When the storage backend migrates from VictoriaMetrics to Azure SQL Database, the query validation logic will need to be updated.

**Date**: 2026-03-07  
**Requirement**: FR-019 — "The API MUST validate all incoming request parameters for presence and type"  
**Scope**: ~9 endpoints, single-user system, ASP.NET Core 8 Minimal API

---

## Endpoints Requiring Validation

| Endpoint | Parameters to Validate |
|----------|----------------------|
| `GET /query` | `query` (required, non-empty), `time` (optional, RFC3339 or Unix epoch) |
| `GET /query_range` | `query` (required), `start` (required, timestamp), `end` (required, timestamp), `step` (required, duration) |
| `GET /series` | `match[]` (required, repeatable, non-empty) |
| `GET /label/{name}/values` | `name` (path param, safe label name pattern) |
| `GET /devices/{device}/metrics` | `device` (path param, safe device name pattern) |
| `GET /grid` | `start` (optional, timestamp), `end` (optional, timestamp), `step` (optional, duration) |
| `GET /devices` | None |
| `GET /labels` | None |
| `GET /health` | None |

**6 of 9 endpoints** need parameter validation. The validation types are:
1. Required non-empty strings
2. Timestamps (RFC3339 or Unix epoch)
3. Duration steps (`1m`, `5m`, `1h`, `30s`)
4. Path parameters (safe alphanumeric + underscore pattern)

---

## Decision

**Manual inline validation with shared static helper methods + `TypedResults`**

No external libraries. No filters. No `[AsParameters]`. Just a small `Validation` static class with pure helper methods, called directly in each endpoint handler.

---

## Rationale

1. **Zero dependencies** — no FluentValidation NuGet, no custom filter infrastructure
2. **Explicit and readable** — validation logic is visible in the handler; reviewers see exactly what's checked
3. **Trivially testable** — static pure methods are unit-testable with no mocking; endpoint integration tests cover the wiring
4. **Proportional to scope** — 6 endpoints need validation, with only 4 distinct validation types. A framework saves nothing here.
5. **No magic** — no attribute-driven implicit behavior, no filter pipeline ordering concerns, no parameter binding edge cases
6. **ASP.NET Core 8 idiomatic** — `TypedResults.BadRequest()` is the built-in Minimal API pattern for typed error responses

---

## Implementation

### 1. Error Response Model

```csharp
// Models/ErrorResponse.cs
namespace EpCubeGraph.Api.Models;

/// <summary>
/// Structured error response for HTTP 400 Bad Request (FR-019).
/// Mirrors the Prometheus API error envelope for consistency.
/// </summary>
public record ErrorResponse(
    string Status,     // always "error"
    string ErrorType,  // "bad_data" for validation errors
    string Error);     // human-readable message
```

### 2. Validation Helpers

```csharp
// Validation/Validate.cs
using System.Globalization;
using System.Text.RegularExpressions;

namespace EpCubeGraph.Api.Validation;

/// <summary>
/// Pure static validation helpers for endpoint parameters (FR-019).
/// Every method returns null on success or an error message string on failure.
/// </summary>
public static partial class Validate
{
    // Safe pattern for path parameters: lowercase alphanumeric + underscores
    // Matches: "device", "epcube_battery", "__name__"
    [GeneratedRegex(@"^[a-zA-Z_][a-zA-Z0-9_]*$", RegexOptions.Compiled)]
    private static partial Regex SafeNamePattern();

    // Duration pattern: positive integer + unit (s, m, h, d, w, y)
    // Matches: "30s", "1m", "5m", "1h", "7d"
    [GeneratedRegex(@"^\d+[smhdwy]$", RegexOptions.Compiled)]
    private static partial Regex DurationPattern();

    /// <summary>
    /// Validates that a required string parameter is present and non-empty.
    /// </summary>
    public static string? RequiredString(string? value, string paramName)
    {
        return string.IsNullOrWhiteSpace(value)
            ? $"Missing or empty required parameter: {paramName}"
            : null;
    }

    /// <summary>
    /// Validates that a timestamp string is either valid RFC3339 or a Unix epoch (integer/float).
    /// Returns null on success, error message on failure.
    /// Accepts: "2026-03-06T00:00:00Z", "1709683200", "1709683200.123"
    /// </summary>
    public static string? Timestamp(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null; // optional — caller checks required separately

        // Try Unix epoch first (integer or decimal)
        if (double.TryParse(value, CultureInfo.InvariantCulture, out var epoch) && epoch >= 0)
            return null;

        // Try RFC3339 / ISO 8601
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out _))
            return null;

        return $"Invalid timestamp for '{paramName}': expected RFC3339 (e.g., 2026-03-06T00:00:00Z) or Unix epoch (e.g., 1709683200)";
    }

    /// <summary>
    /// Validates a Prometheus-style duration string (e.g., "1m", "5m", "1h", "30s").
    /// Returns null on success, error message on failure.
    /// </summary>
    public static string? Duration(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null; // optional — caller checks required separately

        if (!DurationPattern().IsMatch(value))
            return $"Invalid duration for '{paramName}': expected format like 30s, 1m, 5m, 1h, 7d (got '{value}')";

        return null;
    }

    /// <summary>
    /// Validates a path parameter matches the safe name pattern (letters, digits, underscores).
    /// </summary>
    public static string? SafeName(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"Missing required path parameter: {paramName}";

        if (!SafeNamePattern().IsMatch(value))
            return $"Invalid {paramName}: must contain only letters, digits, and underscores (got '{value}')";

        return null;
    }
}
```

### 3. Endpoint Usage Examples

#### GET /api/v1/query

```csharp
group.MapGet("/query", async (
    string? query,
    string? time,
    IVictoriaMetricsClient vm) =>
{
    // Validate (FR-019)
    if (Validate.RequiredString(query, "query") is string qErr)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", qErr));

    if (Validate.Timestamp(time, "time") is string tErr)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", tErr));

    // Passthrough to VictoriaMetrics
    var result = await vm.QueryAsync(query!, time);
    return Results.Ok(result);
})
.RequireAuthorization();
```

#### GET /api/v1/query_range

```csharp
group.MapGet("/query_range", async (
    string? query,
    string? start,
    string? end,
    string? step,
    IVictoriaMetricsClient vm) =>
{
    // Validate all required params (FR-019)
    var errors = new[]
    {
        Validate.RequiredString(query, "query"),
        Validate.RequiredString(start, "start"),
        Validate.RequiredString(end, "end"),
        Validate.RequiredString(step, "step"),
        Validate.Timestamp(start, "start"),
        Validate.Timestamp(end, "end"),
        Validate.Duration(step, "step"),
    }.Where(e => e is not null).ToList();

    if (errors.Count > 0)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", errors.First()!));

    var result = await vm.QueryRangeAsync(query!, start!, end!, step!);
    return Results.Ok(result);
})
.RequireAuthorization();
```

#### GET /api/v1/label/{name}/values

```csharp
group.MapGet("/label/{name}/values", async (
    string name,
    IVictoriaMetricsClient vm) =>
{
    // Validate path param (FR-019)
    if (Validate.SafeName(name, "name") is string err)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", err));

    var result = await vm.LabelValuesAsync(name);
    return Results.Ok(result);
})
.RequireAuthorization();
```

#### GET /api/v1/grid (optional params with defaults)

```csharp
group.MapGet("/grid", async (
    string? start,
    string? end,
    string? step,
    GridCalculator grid) =>
{
    // Validate optional params if provided (FR-019)
    var errors = new[]
    {
        Validate.Timestamp(start, "start"),
        Validate.Timestamp(end, "end"),
        Validate.Duration(step, "step"),
    }.Where(e => e is not null).ToList();

    if (errors.Count > 0)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", errors.First()!));

    var result = await grid.CalculateAsync(start, end, step);
    return Results.Ok(result);
})
.RequireAuthorization();
```

#### GET /api/v1/series (repeatable match[] param)

```csharp
group.MapGet("/series", async (
    [FromQuery(Name = "match[]")] string[]? match,
    string? start,
    string? end,
    IVictoriaMetricsClient vm) =>
{
    // Validate (FR-019)
    if (match is null || match.Length == 0 || match.All(string.IsNullOrWhiteSpace))
        return Results.BadRequest(new ErrorResponse("error", "bad_data",
            "Missing or empty required parameter: match[]"));

    var errors = new[]
    {
        Validate.Timestamp(start, "start"),
        Validate.Timestamp(end, "end"),
    }.Where(e => e is not null).ToList();

    if (errors.Count > 0)
        return Results.BadRequest(new ErrorResponse("error", "bad_data", errors.First()!));

    var result = await vm.SeriesAsync(match, start, end);
    return Results.Ok(result);
})
.RequireAuthorization();
```

### 4. Unit Tests for Validation Helpers

```csharp
// Tests/Unit/ValidateTests.cs
public class ValidateTests
{
    // RequiredString
    [Theory]
    [InlineData(null, "query")]
    [InlineData("", "query")]
    [InlineData("   ", "query")]
    public void RequiredString_RejectsEmptyValues(string? value, string param)
    {
        var error = Validate.RequiredString(value, param);
        Assert.NotNull(error);
        Assert.Contains(param, error);
    }

    [Fact]
    public void RequiredString_AcceptsNonEmptyValue()
    {
        Assert.Null(Validate.RequiredString("up", "query"));
    }

    // Timestamp
    [Theory]
    [InlineData("2026-03-06T00:00:00Z")]      // RFC3339
    [InlineData("2026-03-06T09:00:00+09:00")]  // RFC3339 with offset
    [InlineData("1709683200")]                  // Unix epoch integer
    [InlineData("1709683200.123")]              // Unix epoch decimal
    public void Timestamp_AcceptsValidFormats(string value)
    {
        Assert.Null(Validate.Timestamp(value, "time"));
    }

    [Theory]
    [InlineData("not-a-date")]
    [InlineData("2026-13-01T00:00:00Z")]  // invalid month
    [InlineData("yesterday")]
    public void Timestamp_RejectsInvalidFormats(string value)
    {
        var error = Validate.Timestamp(value, "time");
        Assert.NotNull(error);
        Assert.Contains("time", error);
    }

    [Fact]
    public void Timestamp_ReturnsNullForNullInput()
    {
        Assert.Null(Validate.Timestamp(null, "time"));
    }

    // Duration
    [Theory]
    [InlineData("30s")]
    [InlineData("1m")]
    [InlineData("5m")]
    [InlineData("1h")]
    [InlineData("7d")]
    public void Duration_AcceptsValidFormats(string value)
    {
        Assert.Null(Validate.Duration(value, "step"));
    }

    [Theory]
    [InlineData("5")]        // no unit
    [InlineData("m5")]       // wrong order
    [InlineData("5 m")]      // space
    [InlineData("five min")] // words
    [InlineData("-1m")]      // negative
    public void Duration_RejectsInvalidFormats(string value)
    {
        var error = Validate.Duration(value, "step");
        Assert.NotNull(error);
        Assert.Contains("step", error);
    }

    // SafeName
    [Theory]
    [InlineData("device")]
    [InlineData("epcube_battery")]
    [InlineData("__name__")]
    [InlineData("ip")]
    public void SafeName_AcceptsValidNames(string value)
    {
        Assert.Null(Validate.SafeName(value, "name"));
    }

    [Theory]
    [InlineData("../etc/passwd")]
    [InlineData("device name")]
    [InlineData("device;drop")]
    [InlineData("device<script>")]
    [InlineData("")]
    public void SafeName_RejectsUnsafeNames(string value)
    {
        var error = Validate.SafeName(value, "name");
        Assert.NotNull(error);
    }
}
```

### 5. Error Response Format

All validation errors return HTTP 400 with this body (mirrors Prometheus error envelope):

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Missing or empty required parameter: query"
}
```

This matches the `Common Response Envelope` in the API contract, so clients handle validation errors and VictoriaMetrics errors uniformly.

---

## Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Manual inline + helpers** (chosen) | Zero deps, explicit, testable, proportional to 9 endpoints | Validation logic in handler (not separated) | **Best fit** — simplicity wins for this scope |
| **`[AsParameters]` + Data Annotations** | Declarative, built-in to .NET | Poor support for query strings in Minimal API; `[Required]` doesn't produce the Prometheus error format; custom `ValidationAttribute` needed for timestamps/durations anyway; binding errors produce generic 400s, not structured `ErrorResponse` | Rejected — gains little, loses control over error format |
| **FluentValidation** | Rich DSL, async rules, well-known library | External dependency; requires `SharpGrip.FluentValidation.AutoValidation` or manual filter wiring for Minimal API; validator classes for what amounts to 4 check functions; overkill for this scope | Rejected — over-engineered for 6 endpoints with 4 validation types |
| **Custom `IEndpointFilter`** | Reusable, cross-cutting, clean handler bodies | Adds abstraction layer (filter registration, parameter extraction from `EndpointFilterInvocationContext`); harder to understand parameter access (`context.Arguments`); type-unsafe argument indexing; testing requires filter pipeline setup | Rejected — complexity not justified; helpers achieve the same reuse without framework coupling |
| **MiniValidation library** | Lightweight, works with Data Annotations | Still annotation-driven (same limitations as option 2); extra NuGet dep; doesn't help with custom timestamp/duration formats | Rejected — doesn't solve the hard parts |

---

## Key Design Decisions

1. **First error wins** — return the first validation error, not all of them. This matches Prometheus/VictoriaMetrics behavior and keeps the implementation simple. Users fix one thing at a time.

2. **Error format matches Prometheus envelope** — `{ status, errorType, error }` so clients have a single error-handling path for both validation errors and VictoriaMetrics query errors.

3. **Helpers return `string?`** — `null` means valid, non-null is the error message. This enables the idiomatic pattern:
   ```csharp
   if (Validate.Timestamp(time, "time") is string err)
       return Results.BadRequest(new ErrorResponse("error", "bad_data", err));
   ```

4. **Path params are validated for safety** — even though VictoriaMetrics would handle unknown labels gracefully, we reject path traversal and injection patterns at the API boundary.

5. **`[GeneratedRegex]` for AOT compatibility** — source-generated regexes are faster and AOT-friendly in .NET 8.

6. **Optional timestamp/duration helpers return null for null input** — this separates "is this present?" (RequiredString) from "is this valid?" (Timestamp/Duration), allowing clean composition for both required and optional parameters.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `api/src/EpCubeGraph.Api/Models/ErrorResponse.cs` | Create |
| `api/src/EpCubeGraph.Api/Validation/Validate.cs` | Create |
| `api/tests/EpCubeGraph.Api.Tests/Unit/ValidateTests.cs` | Create |
| `api/src/EpCubeGraph.Api/Endpoints/QueryEndpoints.cs` | Use validation in handlers |
| `api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs` | Use validation in handlers |
| `api/src/EpCubeGraph.Api/Endpoints/GridEndpoints.cs` | Use validation in handlers |

No new NuGet packages required.

---

# Research: Scope Enforcement (`user_impersonation`) via Microsoft.Identity.Web

**Date**: 2026-03-07  
**Requirement**: FR-010a — "System MUST authorize all API requests by requiring the `user_impersonation` scope claim in the JWT. Requests with a valid token that lacks the required scope MUST be rejected with HTTP 403."  
**Scope**: ASP.NET Core 8 Minimal API, single-user system, Entra ID v2.0 tokens

---

## Decision

**Policy-based authorization with `RequireScope` on the default authorization policy**, applied to the `/api/v1` route group via `.RequireAuthorization()`.

No `[RequiredScope]` attribute. No custom `IAuthorizationHandler`. One policy definition in `Program.cs`.

---

## Rationale

### 1. Why policy-based, not `[RequiredScope]` attribute

The `[RequiredScope]` attribute is designed for **controller-based APIs** — it decorates controller classes or action methods. In Minimal API, there are no controllers or action methods to decorate. Route groups use `.RequireAuthorization("PolicyName")` to apply authorization policies.

Both approaches use the same underlying `ScopeAuthorizationHandler` registered by `AddMicrosoftIdentityWebApi`. The attribute internally creates a `ScopeAuthorizationRequirement` — identical to what the policy-based approach does explicitly. The difference is purely in how the requirement reaches the endpoint:

| Approach | Mechanism | Works in Minimal API? |
|----------|-----------|----------------------|
| `[RequiredScope("user_impersonation")]` | Attribute on controller/action | **No** — no controllers to decorate |
| `HttpContext.VerifyUserHasAnyAcceptedScope()` | Imperative call inside handler | Yes, but requires manual call in every handler — violates DRY for 9 endpoints |
| **Policy with `RequireScope`** (chosen) | `AuthorizationPolicyBuilder.RequireScope()` + `.RequireAuthorization()` on route group | **Yes** — one definition, applied to all endpoints in the group automatically |

For a Minimal API with a single scope applied uniformly to all endpoints, the policy-based approach is the only option that is both DRY and idiomatic.

### 2. How `ScopeAuthorizationHandler` validates the scope claim

Source: [`ScopeAuthorizationHandler.cs`](https://github.com/AzureAD/microsoft-identity-web/blob/master/src/Microsoft.Identity.Web/Policy/ScopeAuthorizationHandler.cs)

The handler checks **both** v1.0 and v2.0 scope claim types:

```csharp
var scopeClaims = context.User.FindAll(ClaimConstants.Scp)       // "scp" (v2.0)
    .Union(context.User.FindAll(ClaimConstants.Scope))            // "http://schemas.microsoft.com/identity/claims/scope" (v1.0)
    .ToList();
```

| Token version | Claim type | Claim value example |
|---------------|-----------|---------------------|
| Entra ID v2.0 | `scp` | `"user_impersonation"` |
| Entra ID v1.0 | `http://schemas.microsoft.com/identity/claims/scope` | `"user_impersonation"` |

The handler splits the claim value by spaces (scopes are space-delimited in a single claim) and checks if any of the required scopes are present via `Intersect`. This means a token with `scp: "user_impersonation other_scope"` will match a requirement for `user_impersonation`.

**For this project**: The Entra ID app registration uses the v2.0 endpoint (default for new registrations). Tokens will contain the `scp` claim. The handler's dual-claim check provides forward/backward compatibility at zero cost.

### 3. HTTP response: 403, not 401

When a token is **valid** (authentication succeeds) but the required scope is **missing** (authorization fails):

1. `ScopeAuthorizationHandler.HandleRequirementAsync` finds no matching scope claims → does **not** call `context.Succeed(requirement)` → returns `Task.CompletedTask`
2. ASP.NET Core's authorization middleware sees the requirement was not satisfied
3. Since the user **is authenticated** but **not authorized**, the middleware calls `IAuthorizationMiddlewareResultHandler`, which returns **HTTP 403 Forbidden**

The distinction:
- **401 Unauthorized**: No token, expired token, invalid signature → authentication failure
- **403 Forbidden**: Valid token, but missing required scope/role → authorization failure

This matches FR-010a exactly: "Requests with a valid token that lacks the required scope MUST be rejected with HTTP 403."

### 4. What happens when no scopes are configured

A subtle behavior in the handler: if `scopes` resolves to `null` (no scopes configured in the requirement, no metadata on the endpoint, no configuration key), the handler calls `context.Succeed(requirement)` — effectively allowing access. This is a safe default for APIs that don't need scope enforcement but does mean **you must explicitly configure the required scope**. The policy-based approach below does this correctly.

---

## Implementation

### Program.cs (Minimal API)

```csharp
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// 1. Register Entra ID JWT validation (FR-010)
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration);

// 2. Define authorization policy requiring user_impersonation scope (FR-010a)
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("RequireUserImpersonation", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireScope("user_impersonation");
    });

    // Set as default policy so .RequireAuthorization() uses it without naming
    options.DefaultPolicy = options.GetPolicy("RequireUserImpersonation")!;
});

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

// 3. All /api/v1 endpoints get authentication + scope enforcement
var api = app.MapGroup("/api/v1").RequireAuthorization();

// Endpoint registrations...
api.MapGet("/query", QueryEndpoints.Query);
api.MapGet("/query_range", QueryEndpoints.QueryRange);
api.MapGet("/series", QueryEndpoints.Series);
api.MapGet("/labels", QueryEndpoints.Labels);
api.MapGet("/label/{name}/values", QueryEndpoints.LabelValues);
api.MapGet("/devices", DevicesEndpoints.List);
api.MapGet("/devices/{device}/metrics", DevicesEndpoints.Metrics);
api.MapGet("/grid", GridEndpoints.Grid);
api.MapGet("/health", HealthEndpoints.Health);

// 4. Unauthenticated endpoints (outside the group)
app.MapMetrics(); // prometheus-net /metrics — no auth

app.Run();
```

### appsettings.json

```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<tenant-id>",
    "ClientId": "<app-client-id>",
    "Audience": "api://<app-client-id>"
  }
}
```

### How `.RequireAuthorization()` integrates with the scope policy

The call chain:

1. `options.DefaultPolicy` is set to the `"RequireUserImpersonation"` policy
2. `.RequireAuthorization()` (no arguments) applies the **default policy** to all endpoints in the route group
3. The default policy contains two requirements:
   - `RequireAuthenticatedUser()` — rejects unauthenticated requests with 401
   - `RequireScope("user_impersonation")` — adds a `ScopeAuthorizationRequirement` with `AllowedValues = ["user_impersonation"]`, handled by `ScopeAuthorizationHandler`
4. On each request, ASP.NET Core runs both requirements. If authentication passes but scope is missing → 403

If an endpoint needs to **override** the policy (e.g., `/health` should not require scope), it can use `.RequireAuthorization(policy => policy.RequireAuthenticatedUser())` or `.AllowAnonymous()` individually.

**Alternative**: Instead of setting `DefaultPolicy`, you can name the policy explicitly:

```csharp
var api = app.MapGroup("/api/v1").RequireAuthorization("RequireUserImpersonation");
```

Both are equivalent. Setting `DefaultPolicy` is slightly more concise when all protected endpoints share the same policy, and it means `[Authorize]` (if used anywhere) also inherits the scope requirement.

---

## Alternatives Considered

| Approach | Why Rejected |
|----------|-------------|
| **`[RequiredScope]` attribute** | Designed for controller-based APIs. Cannot be applied to Minimal API route groups or inline handlers. Would require creating controller classes — contradicts the Minimal API architecture chosen for this project. |
| **`HttpContext.VerifyUserHasAnyAcceptedScope()` in each handler** | Works, but requires a manual call at the top of every endpoint handler. For 9 endpoints, this is repetitive and easy to forget. A single policy on the route group is DRY and impossible to accidentally omit. |
| **Custom `IEndpointFilter` for scope** | Could create a filter that checks scopes and returns 403. However, `Microsoft.Identity.Web` already provides `ScopeAuthorizationHandler` which does exactly this via the standard authorization pipeline. Writing a custom filter duplicates built-in functionality. |
| **`RequireAssertion` with inline claim check** | `policy.RequireAssertion(ctx => ctx.User.HasClaim("scp", "user_impersonation"))` works but bypasses `ScopeAuthorizationHandler`'s logic (which checks both `scp` and `http://schemas.microsoft.com/identity/claims/scope`, handles space-delimited scopes, etc.). Using `RequireScope` is semantically clearer and handles edge cases. |

---

## Key Design Decisions

1. **`DefaultPolicy` over named policy** — since all `/api/v1` endpoints require the same scope, setting `DefaultPolicy` eliminates the need to pass a policy name to `.RequireAuthorization()`. Cleaner integration with the existing route group pattern from [research.md](research.md) Topic 2.

2. **No per-endpoint scope variation** — FR-010a explicitly states "No additional role-based or per-endpoint authorization policies are required for this single-user system." A single uniform scope policy matches this requirement exactly.

3. **`RequireAuthenticatedUser()` included in the policy** — the default ASP.NET Core authorization policy already requires an authenticated user, but including it explicitly makes the policy self-documenting and independent of ASP.NET Core defaults.

4. **`RequireScope` over `ScopeAuthorizationRequirement` constructor** — `RequireScope` is an extension method on `AuthorizationPolicyBuilder` provided by Microsoft.Identity.Web. It creates the `ScopeAuthorizationRequirement` internally. The extension method is more readable than `policy.Requirements.Add(new ScopeAuthorizationRequirement(new[] { "user_impersonation" }))`.

5. **`/health` endpoint inside the protected group** — the spec's acceptance scenario 2 (US2) states "an unauthenticated request is made to the API → rejected with an appropriate error." This implies even `/health` requires auth when accessed via `/api/v1/health`. The unauthenticated health check for Container Apps probes can use a separate liveness endpoint outside the group if needed.

---

## Files to Modify

| File | Change |
|------|--------|
| `api/src/EpCubeGraph.Api/Program.cs` | Add `RequireScope("user_impersonation")` to authorization policy; set `DefaultPolicy` |

No new files. No new NuGet packages (scope support is built into `Microsoft.Identity.Web`).
