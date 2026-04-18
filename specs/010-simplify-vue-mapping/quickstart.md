# Quickstart: Feature 010 — Simplify Vue Device Mapping

## Prerequisites

- Node.js 22+, npm
- .NET 10 SDK
- Docker + Docker Compose (for API integration tests)
- Existing `vue_device_mapping` with old array format (for migration testing)

## Development Workflow

### 1. Dashboard Changes

```bash
cd dashboard

# Run tests (TDD — write failing tests first)
npm run test:watch

# Type check (vitest doesn't catch type errors)
npm run typecheck

# Full coverage check
npm run test:coverage
```

**Key files to modify**:
- `src/types.ts` — `VueDeviceMapping` type change
- `src/hooks/useVueData.ts` — Add format validation (type guard)
- `src/components/SettingsPage.tsx` — Single-select editor
- `src/components/CircuitsPage.tsx` — Update parser
- `src/components/EnergyFlowDiagram.tsx` — Update parser

### 2. API Changes

```bash
cd api

# Run tests
dotnet test EpCubeGraph.sln

# Full coverage check
rm -rf TestResults CoverageMerged
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

**Key file to modify**:
- `src/EpCubeGraph.Api/Endpoints/SettingsEndpoints.cs` — Validation logic

### 3. Manual Testing

```bash
# Start local stack with real data
cd local
docker compose -f docker-compose.prod-local.yml up -d

# Start API
cd ../api/src/EpCubeGraph.Api && dotnet run  # http://localhost:5062

# Start dashboard
cd ../../../dashboard && npm run dev         # http://localhost:5173
```

1. Open Settings → Vue Mapping section
2. If old format exists, verify reconfiguration prompt appears
3. Select parent device from dropdown, save
4. Navigate to Flow diagram — verify circuits render correctly
5. Navigate to Circuits page — verify panel grouping unchanged

## Testing Strategy

1. **Type guard**: Unit test `isValidVueDeviceMapping()` with old format, new format, edge cases
2. **Parser tests**: Update all mock data from array to single-object format
3. **Migration guard**: Test that old format triggers reconfiguration prompt
4. **API validation**: Update integration tests for new format + old format rejection
5. **Regression**: All existing 484 dashboard + 375 API tests must continue to pass
