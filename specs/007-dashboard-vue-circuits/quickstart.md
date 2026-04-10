# Quickstart: Dashboard Vue Circuit Display

**Branch**: `007-dashboard-vue-circuits` | **Date**: 2026-04-09

## Prerequisites

- Feature 005 (Emporia Vue) fully implemented and merged
- Feature 006 (Settings Page) fully implemented and merged
- PostgreSQL running with Feature 005 tables populated
- Node.js 22+ and npm installed
- .NET 10 SDK installed

## Local Development Setup

### 1. Start the local stack

```bash
cd local
docker compose -f docker-compose.prod-local.yml up -d
```

### 2. Verify Vue data exists

```bash
# Check Vue devices
docker exec -it epcubegraph-postgres psql -U epcube -d epcubegraph \
  -c "SELECT device_gid, device_name, connected FROM vue_devices;"

# Check Vue readings
docker exec -it epcubegraph-postgres psql -U epcube -d epcubegraph \
  -c "SELECT COUNT(*) FROM vue_readings WHERE timestamp > NOW() - INTERVAL '5 minutes';"
```

### 3. Run the API

```bash
cd api
dotnet run --project src/EpCubeGraph.Api
```

### 4. Run the dashboard

```bash
cd dashboard
npm install
npm run dev
```

### 5. Verify endpoints

```bash
# Bulk current readings
curl http://localhost:5062/api/v1/vue/readings/current

# Daily readings
curl "http://localhost:5062/api/v1/vue/readings/daily?date=$(date +%Y-%m-%d)"

# Settings (check vue_device_mapping)
curl http://localhost:5062/api/v1/settings
```

## Running Tests

### Dashboard

```bash
cd dashboard
npm run typecheck          # TypeScript type checking
npm run test:coverage      # Vitest with coverage
```

### API

```bash
cd api
dotnet test EpCubeGraph.sln

# Full coverage check (matches CI gate)
cd api && rm -rf TestResults CoverageMerged
dotnet test EpCubeGraph.sln \
  --collect:"XPlat Code Coverage" \
  --results-directory ./TestResults \
  --settings tests/EpCubeGraph.Api.Tests/coverlet.runsettings
~/.dotnet/tools/reportgenerator \
  -reports:"./TestResults/**/coverage.cobertura.xml" \
  -targetdir:./CoverageMerged \
  -reporttypes:TextSummary
cat ./CoverageMerged/Summary.txt
```

### Exporter

```bash
cd local/epcube-exporter
python -m pytest test_exporter.py -v
```

## Key Files

| Component | Files |
|-----------|-------|
| API: New endpoints | `api/src/EpCubeGraph.Api/Endpoints/VueEndpoints.cs` |
| API: Vue store | `api/src/EpCubeGraph.Api/Services/IVueStore.cs`, `PostgresVueStore.cs` |
| API: Settings allowlist | `api/src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` |
| API: Models | `api/src/EpCubeGraph.Api/Models/` |
| Dashboard: Types | `dashboard/src/types.ts` |
| Dashboard: API client | `dashboard/src/api.ts` |
| Dashboard: Flow diagram | `dashboard/src/components/EnergyFlowDiagram.tsx` |
| Dashboard: Current Readings | `dashboard/src/components/CurrentReadings.tsx` |
| Dashboard: Circuits page | `dashboard/src/components/CircuitsPage.tsx` (new) |
| Dashboard: Settings page | `dashboard/src/components/SettingsPage.tsx` |
| Dashboard: App routing | `dashboard/src/App.tsx` |
| Exporter: Daily poll | `local/epcube-exporter/exporter.py` |
