# Tasks: EP Cube Telemetry Data Ingestor

**Input**: Design documents from `/specs/001-data-ingestor/`  
**Feature Issue**: [#3](https://github.com/sstjean/epcubegraph/issues/3) · **User Stories**: [US1 #9](https://github.com/sstjean/epcubegraph/issues/9) · [US2 #10](https://github.com/sstjean/epcubegraph/issues/10) · [US3 #11](https://github.com/sstjean/epcubegraph/issues/11)

This active task record reflects the current PostgreSQL-based implementation.

## Phase 1: Setup

- [x] Create the API solution, project layout, and test project
- [x] Create exporter and infrastructure directory structure
- [x] Configure code quality defaults and warning-as-error behavior

## Phase 2: Foundational API Work

- [x] Configure Entra ID authentication and scope-based authorization
- [x] Add shared validation helpers and shared response models
- [x] Wire structured JSON logging, Swagger, and `/metrics`
- [x] Introduce `IMetricsStore` and the PostgreSQL-backed store implementation

## Phase 3: Exporter and Schema

- [x] Build the exporter Docker image and runtime configuration
- [x] Create PostgreSQL schema bootstrap for `devices` and `readings`
- [x] Add device upsert logic
- [x] Add deduplicating reading writes
- [x] Add exporter health and debug endpoints

## Phase 4: API Endpoints

- [x] Implement `/api/v1/health`
- [x] Implement `/api/v1/readings/current`
- [x] Implement `/api/v1/readings/range`
- [x] Implement `/api/v1/readings/grid`
- [x] Implement `/api/v1/devices`
- [x] Implement `/api/v1/devices/{device}/metrics`
- [x] Implement `/api/v1/grid`

## Phase 5: Azure Infrastructure

- [x] Provision Container Apps environment
- [x] Provision Key Vault and managed identity wiring
- [x] Provision Azure Database for PostgreSQL Flexible Server
- [x] Configure private runtime networking and DNS
- [x] Wire API and exporter secrets from Key Vault
- [x] Add deployment validation and deployment outputs

## Phase 6: Quality Gates

- [x] Add API unit and integration coverage to CI
- [x] Add exporter automated tests
- [x] Add Docker and Terraform validation to CI
- [x] Enforce 100% coverage gates
- [x] Add deployment validation checks to CD

## Phase 7: Documentation Alignment

- [x] Publish the active PostgreSQL-based spec, plan, quickstart, data model, research notes, and API contract
- [x] Remove retired architecture text from active Feature 001 documentation
- [ ] Update GitHub issues to remove stale architecture language

## Notes

- The remaining unchecked item is an issue-tracker synchronization step, not a code or infrastructure gap.
- Any retired architecture detail belongs only in explicitly historical context, not in active task wording.
