# Development Environment Setup

**Project**: EP Cube Graph  
**Date**: 2026-03-08

---

## Quick Start

Run the setup script for your OS. Both scripts are safe to re-run and will skip anything already installed.

### macOS 15 (Sequoia) or higher

```bash
./scripts/setup-macos.sh
```

### Windows 11 or higher

Open PowerShell **as Administrator** and run:

```powershell
.\scripts\setup-windows.ps1
```

Use `--check` (macOS) or `-Check` (Windows) to see what's missing without installing anything.

---

## What Gets Installed

| Tool | Version | Purpose |
|------|---------|---------|
| Git | 2.x | Source control, image tagging |
| .NET SDK | 10.0 | Build the ASP.NET Core API |
| Terraform | 1.5+ | Azure infrastructure provisioning |
| Azure CLI (`az`) | 2.60+ | Azure authentication, ACR login |
| Docker Desktop | 24+ | Container builds (includes Compose v2) |
| Node.js | 22.0+ | Build the web dashboard SPA |
| VS Code | latest | IDE |
| GitHub CLI (`gh`) | 2.x | Issue tracking (optional) |

**VS Code extensions** installed automatically: C# Dev Kit, Terraform, Docker, GitHub Copilot.

---

## Prerequisites

You also need:
- An Azure subscription with Owner or Contributor + User Access Administrator role
- EP Cube cloud account credentials (for `monitoring-us.epcube.com`)

---

## Keeping Tools in Sync

The canonical tool list lives in `scripts/tools.json`. When adding or changing tools:

1. Update `scripts/tools.json` (the single source of truth)
2. Update `scripts/setup-macos.sh` with the install logic
3. Update `scripts/setup-windows.ps1` with the install logic
4. Update the table above in this file

CI runs `scripts/validate-tool-sync.sh` on every push/PR to catch drift between these files.

---

## Next Steps

Once your environment is set up, see [DEPLOY.md](DEPLOY.md) for deployment instructions.
