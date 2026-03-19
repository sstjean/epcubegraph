# Tasks: EP Cube Telemetry Data Ingestor

**Input**: Design documents from `/specs/001-data-ingestor/`  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3) · **User Stories**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-v1.md, quickstart.md

**Tests**: Included — constitution mandates TDD with 100% code coverage (non-negotiable).

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3) this task belongs to
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, .NET solution scaffolding

- [x] T001 Create directory structure per plan.md: api/src/EpCubeGraph.Api/{Models,Services,Endpoints}, api/tests/EpCubeGraph.Api.Tests/{Unit,Integration,Fixtures}, local/{epcube-exporter,mock-exporter}, infra/
- [x] T002 Initialize .NET solution: create api/EpCubeGraph.sln, api/src/EpCubeGraph.Api/EpCubeGraph.Api.csproj (.NET 10, web SDK), add NuGet packages: Microsoft.Identity.Web, Swashbuckle.AspNetCore, prometheus-net.AspNetCore (8.2.1)
- [x] T003 [P] Initialize test project: create api/tests/EpCubeGraph.Api.Tests/EpCubeGraph.Api.Tests.csproj with xunit, coverlet.collector, Microsoft.AspNetCore.Mvc.Testing, Testcontainers, add project reference to API project
- [x] T004 [P] Create api/.editorconfig with C# coding conventions and api/Directory.Build.props with TreatWarningsAsErrors and nullable enabled

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create appsettings.json with AzureAd (Instance, TenantId, ClientId, Audience) and VictoriaMetrics (Url) sections in api/src/EpCubeGraph.Api/appsettings.json
- [x] T006 [P] Configure Microsoft.Identity.Web authentication and authorization middleware in api/src/EpCubeGraph.Api/Program.cs (AddMicrosoftIdentityWebApiAuthentication, AddAuthorization with RequireScope("user_impersonation") as DefaultPolicy, UseAuthentication, UseAuthorization)
- [x] T007 [P] Define IVictoriaMetricsClient interface with QueryAsync, QueryRangeAsync, SeriesAsync, LabelsAsync, LabelValuesAsync methods in api/src/EpCubeGraph.Api/Services/IVictoriaMetricsClient.cs
- [x] T008 [P] Create VictoriaMetricsFixture using Testcontainers for .NET (pulls victoriametrics/victoria-metrics image, configures -retentionPeriod=5y, -dedup.minScrapeInterval=1m) in api/tests/EpCubeGraph.Api.Tests/Fixtures/VictoriaMetricsFixture.cs
- [x] T009 Configure global error handling, JSON serialization (camelCase), Swagger/OpenAPI, and logging in api/src/EpCubeGraph.Api/Program.cs

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 3 — Cloud-Deployed Ingestion Stack (Priority: P1)

**Goal**: Deploy epcube-exporter as a Container App in Azure, scraped directly by VictoriaMetrics via `-promscrape.config`. EP Cube cloud credentials stored in Key Vault.

**Independent Test**: Run `infra/deploy.sh` to verify epcube-exporter Container App deploys, VictoriaMetrics scrapes it, and metrics appear in VictoriaMetrics.

**FRs covered**: FR-015, FR-016, FR-017

**Also covers (indirectly)**: FR-001, FR-002 (epcube-exporter polls both EP Cube 1.0 and 2.0 devices via the cloud API), FR-006 (epcube-exporter retries on next poll cycle; VictoriaMetrics handles scrape failures gracefully)

### Implementation for User Story 3

- [x] T010 [P] [US3] Create epcube-exporter Dockerfile with python:3.12-slim base, opencv-python-headless, pycryptodome, numpy in local/epcube-exporter/Dockerfile
- [x] T011 [P] [US3] Create VictoriaMetrics promscrape configuration targeting epcube-exporter Container App with 60s scrape interval, 30s timeout in infra/main.tf (promscrape_config local)
- [x] T012 [P] [US3] Add epcube_username, epcube_password, epcube_image variables to infra/variables.tf; add EP Cube credential secrets to infra/keyvault.tf
- [x] T013 [US3] Add epcube-exporter Container App resource with external ingress (JWT-authenticated debug page), Key Vault secret references, and ACR registry in infra/container-apps.tf; add promscrape config to VictoriaMetrics

**Checkpoint**: `terraform validate` passes. epcube-exporter Container App deploys with VictoriaMetrics scraping it directly.

---

## Phase 4: User Story 1 — Ingest Telemetry / Azure Infrastructure (Priority: P1)

**Goal**: Deploy VictoriaMetrics on Azure Container Apps with internal-only ingress, promscrape scraping epcube-exporter, Key Vault for secrets, 5-year retention, deduplication

**Independent Test**: Deploy Terraform to a resource group. Verify VictoriaMetrics is internal-only (no external ingress), verify promscrape scrapes epcube-exporter, and confirm metrics appear in VictoriaMetrics.

**FRs covered**: FR-005, FR-007, FR-011, FR-014

**Note on FR-011 (UTC normalization)**: VictoriaMetrics stores all timestamps as Unix epoch (inherently UTC). No application-level normalization code is required.

### Implementation for User Story 1

- [x] T014 [P] [US1] Create Key Vault Terraform module for EP Cube credential and OAuth secret storage with access policy in infra/keyvault.tf
- [x] T015 [P] [US1] Create deployment variables file with environment name, location, container image settings in infra/variables.tf
- [x] T016 [US1] Create main Terraform configuration: Container Apps environment, VictoriaMetrics container (-retentionPeriod=5y, -dedup.minScrapeInterval=1m, -storageDataPath with persistent volume, internal-only ingress on port 8428), promscrape config targeting epcube-exporter, API container placeholder in infra/container-apps.tf
- [x] T017 [US1] Add Entra ID app registration and managed identity resources in infra/entra.tf for API authentication (FR-010)
- [x] T051 [US1] Create VNet with infrastructure and private endpoints subnets, private endpoints + DNS zones for Key Vault and Storage in infra/network.tf (added retroactively — implemented during Bug #14 resolution)
- [x] T053 [US1] Configure Azure File Share mount for VictoriaMetrics persistent storage (access_key via private endpoint — platform limitation documented in plan.md Complexity Tracking) in infra/storage.tf, infra/container-apps.tf

**Checkpoint**: `terraform validate` passes. VictoriaMetrics accepts promscrape-based ingestion from epcube-exporter.

---

## Phase 5: User Story 2 — Expose Telemetry via Versioned API (Priority: P2) 🎯 MVP

**Goal**: C# ASP.NET Core Minimal API querying VictoriaMetrics via PromQL, Entra ID JWT auth, derived grid calculation, versioned at /api/v1

**Independent Test**: Issue authenticated API requests for /query_range, /devices, /grid with test data in VictoriaMetrics. Verify correct results. Verify unauthenticated requests return 401. Verify empty time ranges return empty result (not error).

**FRs covered**: FR-003a, FR-008, FR-009, FR-010, FR-010a, FR-019, FR-020, FR-021

### Tests for User Story 2 (TDD — write tests FIRST, confirm they FAIL)

- [x] T018 [P] [US2] Write VictoriaMetricsClient unit tests (QueryAsync, QueryRangeAsync, SeriesAsync, error handling, timeout) mocking HttpMessageHandler in api/tests/EpCubeGraph.Api.Tests/Unit/VictoriaMetricsClientTests.cs
- [x] T019 [P] [US2] Write GridCalculator unit tests (derived grid PromQL construction, sign convention: positive=import/negative=export) in api/tests/EpCubeGraph.Api.Tests/Unit/GridCalculatorTests.cs
- [x] T020 [P] [US2] Write DeviceInfo record tests (serialization, optional fields, DeviceClass values) in api/tests/EpCubeGraph.Api.Tests/Unit/DeviceInfoTests.cs
- [x] T038 [P] [US2] Write Validate helper unit tests (Required, Timestamp, Duration, SafeName — null=valid, invalid=error, valid=pass) in api/tests/EpCubeGraph.Api.Tests/Unit/ValidateTests.cs
- [x] T052 [P] [US2] Write model serialization tests (JSON round-trip for all response records) in api/tests/EpCubeGraph.Api.Tests/Unit/ModelSerializationTests.cs (added retroactively)

### Models for User Story 2

- [x] T021 [P] [US2] Create DeviceInfo record with [JsonPropertyName] annotations: Device→"device", DeviceClass→"class", Manufacturer?→"manufacturer", ProductCode?→"product_code", Uid?→"uid", Online→"online" in api/src/EpCubeGraph.Api/Models/DeviceInfo.cs
- [x] T022 [P] [US2] Create HealthResponse record (Status, VictoriaMetrics) in api/src/EpCubeGraph.Api/Models/HealthResponse.cs
- [x] T023 [P] [US2] Create DeviceMetricsResponse record (Device, Metrics list) in api/src/EpCubeGraph.Api/Models/DeviceMetricsResponse.cs
- [x] T024 [P] [US2] Create DeviceListResponse record (Devices list) in api/src/EpCubeGraph.Api/Models/DeviceListResponse.cs
- [x] T039 [P] [US2] Create ErrorResponse record (Status, ErrorType, Error) with [JsonPropertyName] annotations in api/src/EpCubeGraph.Api/Models/ErrorResponse.cs

### Validation for User Story 2

- [x] T040 [P] [US2] Create Validate static helper class: Required(string? value, string paramName), Timestamp(string? value, string paramName), Duration(string? value, string paramName), SafeName(string? value, string paramName) — each returns null on valid, TypedResults.BadRequest<ErrorResponse> on invalid in api/src/EpCubeGraph.Api/Validate.cs

### Services for User Story 2

- [x] T025 [US2] Implement VictoriaMetricsClient using HttpClient with IHttpClientFactory DI registration: QueryAsync, QueryRangeAsync, SeriesAsync, LabelsAsync, LabelValuesAsync in api/src/EpCubeGraph.Api/Services/VictoriaMetricsClient.cs
- [x] T026 [US2] Implement GridCalculator: constructs PromQL expression (epcube_grid_import_kwh - epcube_grid_export_kwh), delegates to IVictoriaMetricsClient.QueryRangeAsync, defaults start=24h ago, end=now, step=1m in api/src/EpCubeGraph.Api/Services/GridCalculator.cs

### Endpoints for User Story 2

- [x] T027 [P] [US2] Implement HealthEndpoints: GET /api/v1/health (unauthenticated, static HealthResponse("healthy", "ok") with 200 — no VictoriaMetrics dependency) in api/src/EpCubeGraph.Api/Endpoints/HealthEndpoints.cs
- [x] T028 [US2] Implement QueryEndpoints: GET /api/v1/query, GET /api/v1/query_range, GET /api/v1/series, GET /api/v1/labels, GET /api/v1/label/{name}/values as authenticated PromQL passthrough to VictoriaMetrics in api/src/EpCubeGraph.Api/Endpoints/QueryEndpoints.cs
- [x] T029 [US2] Implement DevicesEndpoints: GET /api/v1/devices (queries epcube_device_info + epcube_scrape_success, returns DeviceListResponse), GET /api/v1/devices/{device}/metrics (queries series for device label, returns DeviceMetricsResponse or 404) in api/src/EpCubeGraph.Api/Endpoints/DevicesEndpoints.cs
- [x] T030 [US2] Implement GridEndpoints: GET /api/v1/grid (optional start, end, step params, delegates to GridCalculator, returns PromQL range result) in api/src/EpCubeGraph.Api/Endpoints/GridEndpoints.cs

### Wiring and Integration for User Story 2

- [x] T031 [US2] Register all services (AddHttpClient<IVictoriaMetricsClient, VictoriaMetricsClient>, AddScoped<GridCalculator>) and map all endpoint groups (.MapGroup("/api/v1").RequireAuthorization() for authenticated, AllowAnonymous for health) in api/src/EpCubeGraph.Api/Program.cs
- [x] T041 [US2] Wire prometheus-net middleware: UseHttpMetrics(), MapMetrics("/metrics").AllowAnonymous() (outside auth group) for self-monitoring (FR-021) in api/src/EpCubeGraph.Api/Program.cs
- [x] T042 [US2] Configure structured JSON logging: builder.Logging.AddJsonConsole(), add ILogger injection and log statements for auth failures (401/403), VictoriaMetrics query errors, and request durations (FR-020) in api/src/EpCubeGraph.Api/Program.cs
- [x] T032 [US2] Write VictoriaMetrics integration tests using VictoriaMetricsFixture: insert test data via remote-write, verify QueryRangeAsync returns correct time series, verify empty range returns empty result in api/tests/EpCubeGraph.Api.Tests/Integration/VictoriaMetricsIntegrationTests.cs
- [x] T033 [US2] Write API integration tests using WebApplicationFactory: verify authenticated requests return 200, unauthenticated return 401, /health returns 200 without auth, /query with invalid PromQL returns 400 in api/tests/EpCubeGraph.Api.Tests/Integration/ApiIntegrationTests.cs
- [x] T043 [US2] Write SC-003 performance test: seed 30 days synthetic data via VictoriaMetricsFixture, assert query_range returns within 2 seconds in api/tests/EpCubeGraph.Api.Tests/Integration/PerformanceTests.cs
- [x] T034 [US2] Create API Dockerfile: multi-stage build with mcr.microsoft.com/dotnet/sdk:10.0 (build) and mcr.microsoft.com/dotnet/aspnet:10.0-alpine (runtime), EXPOSE 8080 in api/Dockerfile

**Checkpoint**: All API endpoints functional, all tests pass with 100% coverage. User Stories 1, 2, and 3 all work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Coverage enforcement, end-to-end validation, security hardening

- [x] T035 [P] Enforce 100% code coverage: add coverlet threshold configuration to EpCubeGraph.Api.Tests.csproj (<ThresholdType>line</ThresholdType><Threshold>100</Threshold>) and verify `dotnet test --collect:"XPlat Code Coverage"` passes
- [x] T036 Run quickstart.md end-to-end validation: clone, dotnet build, dotnet test, docker compose build, az deployment validate. Also verify SC-001/SC-002 infrastructure: VictoriaMetrics uses persistent Azure File Share, `up` metric is populated after deployment, and ephemeral storage edge case (L2) is mitigated by persistent volume mount
- [x] T037 [P] Security review: verify all telemetry endpoints reject unauthenticated requests (SC-004), verify /health exposes no telemetry data, verify VictoriaMetrics is internal-only (no external ingress)
- [x] T044 [P] Create CI pipeline: .github/workflows/ci.yml with dotnet build, dotnet test --collect:"XPlat Code Coverage" (fail if <100%), docker compose build (local/), terraform validate + terraform fmt -check (infra/), container image build+push with tagged versions (no :latest). Pipeline MUST produce zero warnings on a clean run (constitution: CI/CD Zero Warnings)
- [x] T050 [P] Create CD pipeline: .github/workflows/cd.yml with OIDC Azure login, Terraform apply (remote state), ACR image build+push, deployment validation via validate-deployment.sh, optional environment teardown. Triggers on CI success for main branch or manual dispatch with environment selection (staging/production). Pipeline MUST produce zero warnings on a clean run (constitution: CI/CD Zero Warnings)

---

## Phase 7: Exporter Enhancements (Operational)

**Purpose**: Health endpoint, debug status page, JWT auth, and test coverage for epcube-exporter

**FRs covered**: FR-022, FR-023, FR-024

- [x] T045 [US3] Add health endpoint to epcube-exporter: GET /health returns 200 {"status":"ok"} when healthy, 503 {"status":"unhealthy","reasons":[...]} when no poll in 5 min or 5+ consecutive errors (FR-022) in local/epcube-exporter/exporter.py
- [x] T046 [US3] Add debug status page to epcube-exporter: GET / and /status render HTML showing last 10 poll snapshots with per-device tables, uptime, poll count, error count, health chiclet, auto-refresh, browser timezone conversion (FR-023) in local/epcube-exporter/exporter.py
- [x] T047 [US3] Add auth to epcube-exporter: OAuth 2.0 Authorization Code flow with PKCE for browser access (/login → Entra ID → /.auth/callback → session cookie), Bearer JWT validation for API clients, bypass with EPCUBE_DISABLE_AUTH=true for local dev, /metrics and /health unauthenticated (FR-023, FR-024) in local/epcube-exporter/exporter.py
- [x] T048 [US3] Update Terraform to deploy epcube-exporter with external ingress, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_AUDIENCE, AZURE_CLIENT_SECRET (Key Vault), AZURE_REDIRECT_URI env vars, and Entra ID redirect URI registration (FR-024) in infra/container-apps.tf, infra/entra.tf, infra/keyvault.tf
- [x] T049 [US3] Add comprehensive Python test suite for epcube-exporter: 49 tests covering health checks, energy balance, snapshot dedup, poll counters, debug page rendering, HTTP routing, auth, Prometheus metrics format, re-authentication in local/epcube-exporter/test_exporter.py
- [x] T054 [P] [US2] Write endpoint integration tests (all API routes: query, query_range, series, labels, label values, devices, device metrics, grid, health — success and error paths) in api/tests/EpCubeGraph.Api.Tests/Integration/EndpointTests.cs (added retroactively — 76 tests)
- [x] T055 [P] [US2] Write Program.cs middleware integration tests (Swagger, CORS, JSON serialization, exception handling, metrics endpoint) in api/tests/EpCubeGraph.Api.Tests/Integration/ProgramMiddlewareTests.cs (added retroactively — 5 tests)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US3 (Phase 3)**: Depends on Foundational — no code dependencies on other stories (Docker + Terraform only)
- **US1 (Phase 4)**: Depends on Foundational — no code dependencies on other stories (Terraform only)
- **US2 (Phase 5)**: Depends on Foundational — uses IVictoriaMetricsClient interface and auth from Phase 2
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US3 (P1)**: Can start after Foundational — no dependencies on US1 or US2
- **US1 (P1)**: Can start after Foundational — no dependencies on US3 or US2
- **US2 (P2)**: Can start after Foundational — no dependencies on US1 or US3 (uses Testcontainers for VictoriaMetrics, not Azure deployment)
- **US3 and US1** can run in parallel since they involve different files (local/ vs infra/)
- **US2** can also run in parallel with US1/US3 if staffed

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD — constitution)
- Models before services
- Services before endpoints
- Core implementation before integration tests
- Story complete before moving to next priority

---

## Parallel Opportunities

### Phase 1 (Setup)
```
T001 (directories) → T002 (solution)
                   ↘ T003 [P] (test project)
                   ↘ T004 [P] (editorconfig)
```

### Phase 2 (Foundational)
```
T005 (appsettings) → T009 (error handling + swagger)
T006 [P] (auth middleware)
T007 [P] (IVictoriaMetricsClient interface)
T008 [P] (VictoriaMetricsFixture)
```

### Phase 3 (US3) + Phase 4 (US1) — can run entirely in parallel
```
US3: T010 [P], T011 [P], T012 [P] → T013
US1: T014 [P], T015 [P] → T016 → T017
```

### Phase 5 (US2)
```
# Tests first (all parallel):
T018 [P], T019 [P], T020 [P], T038 [P]

# Models + Validation (all parallel):
T021 [P], T022 [P], T023 [P], T024 [P], T039 [P], T040 [P]

# Services (sequential, depend on models + interface):
T025 → T026

# Endpoints (T027 parallel, then T028-T030 sequential after services):
T027 [P]
T028 → T029 → T030

# Wiring + integration:
T031 → T041, T042 → T032, T033, T043 → T034
```

### Phase 6 (Polish)
```
T035 [P], T037 [P], T044 [P]
T036 (depends on all above)
```

---

## Implementation Strategy

### MVP First (US3 + US1 + US2)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US3 (epcube-exporter Container App)
4. Complete Phase 4: US1 (Azure infrastructure)
5. Complete Phase 5: US2 (API)
6. **STOP and VALIDATE**: All three stories independently testable
7. Complete Phase 6: Polish

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US3 → `deploy.sh` builds and pushes epcube-exporter → Container App deployable
3. US1 → Terraform deploys → VictoriaMetrics accepts remote-write and scrapes epcube-exporter
4. US2 → API serves queries → Full pipeline operational (MVP!)
5. Polish → 100% coverage enforced, security verified

### Parallel Strategy

With capacity for parallel work:

1. Complete Setup + Foundational together
2. Once Foundational is done:
   - Stream A: US3 (Docker) + US1 (Terraform) — no C# involved
   - Stream B: US2 (API) — all C# work
3. Streams converge at Polish phase

---

## Notes

- All file paths are relative to repository root
- TDD is mandated by constitution — tests MUST fail before implementation
- 100% code coverage enforced via coverlet in CI
- US3 and US1 contain no C# code (Docker + Terraform) so TDD applies only to US2
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently

---

## Future: Phase 8 — Full DevOps CD Pipeline (Issue [#12](https://github.com/sstjean/epcubegraph/issues/12))

**Status**: Not started — tracked in GitHub Issue #12, out of scope for initial 001-data-ingestor implementation  
**Purpose**: Evolve CI/CD from current single-environment pipeline (T044/T050) to full DevOps process: staging on push, production on merge to main, no hardcoded branch names  
**Depends on**: Phase 6 (Polish) completion + merge to main
