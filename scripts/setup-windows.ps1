# EP Cube Graph — Windows Development Environment Setup
# Supports Windows 11 or higher.
#
# Installs all tools required to develop, build, and deploy the application.
# Safe to re-run — skips anything already installed.
#
# IMPORTANT: The canonical tool list lives in scripts/tools.json.
# When adding or changing tools, update tools.json first, then this script.
# CI runs scripts/validate-tool-sync.sh to catch drift.
#
# Usage (run as Administrator in PowerShell):
#   .\setup-windows.ps1           # Install everything
#   .\setup-windows.ps1 -Check   # Check what's installed without changing anything

param(
    [switch]$Check
)

$ErrorActionPreference = "Stop"

# -- Helpers -------------------------------------------------------------------

function Write-Header { param([string]$Text) Write-Host "`n-- $Text --" -ForegroundColor White }
function Write-Ok     { param([string]$Text) Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Skip   { param([string]$Text) Write-Host "  ✓ $Text (already installed)" -ForegroundColor Green }
function Write-Warn   { param([string]$Text) Write-Host "  ⚠ $Text" -ForegroundColor Yellow }
function Write-Err    { param([string]$Text) Write-Host "  ✗ $Text" -ForegroundColor Red }
function Write-Info   { param([string]$Text) Write-Host "  → $Text" -ForegroundColor Cyan }

$script:Missing   = 0
$script:Installed  = 0

function Test-Command {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# -- Windows version check ----------------------------------------------------

Write-Header "System Check"

$osVersion = [System.Environment]::OSVersion.Version
$buildNumber = $osVersion.Build

# Windows 11 is build 22000+
if ($buildNumber -lt 22000) {
    Write-Err "Windows build $buildNumber detected. This script requires Windows 11 (build 22000+)."
    exit 1
}
Write-Ok "Windows 11 (build $buildNumber)"
Write-Ok "Architecture: $env:PROCESSOR_ARCHITECTURE"

# -- Admin check ---------------------------------------------------------------

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $Check) {
    Write-Err "This script must be run as Administrator. Right-click PowerShell → 'Run as administrator'."
    exit 1
}
if ($isAdmin) {
    Write-Ok "Running as Administrator"
} else {
    Write-Warn "Not running as Administrator (check-only mode)"
}

# -- winget check --------------------------------------------------------------

Write-Header "Package Manager"

if (Test-Command "winget") {
    $wingetVer = (winget --version 2>$null) -replace '^v', ''
    Write-Skip "winget $wingetVer"
} else {
    Write-Err "winget not found. It should be pre-installed on Windows 11."
    Write-Err "Install 'App Installer' from the Microsoft Store, then re-run."
    exit 1
}

# -- Git -----------------------------------------------------------------------

Write-Header "Git"

if (Test-Command "git") {
    $gitVer = (git --version 2>$null) -replace 'git version ', ''
    Write-Skip "Git $gitVer"
} elseif ($Check) {
    Write-Err "Git — NOT FOUND (need 2.0+)"
    $script:Missing++
} else {
    Write-Info "Installing Git..."
    winget install --id Git.Git --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "Git installed"
    $script:Installed++
}

# -- .NET SDK ------------------------------------------------------------------

Write-Header ".NET SDK"

$dotnetRequired = "10.0"

if (Test-Command "dotnet") {
    $dotnetVer = (dotnet --version 2>$null)
    if ($dotnetVer -like "10.*") {
        Write-Skip ".NET SDK $dotnetVer"
    } else {
        Write-Warn ".NET SDK $dotnetVer found, but $dotnetRequired.x required"
        if ($Check) {
            $script:Missing++
        } else {
            Write-Info "Installing .NET SDK $dotnetRequired..."
            winget install --id Microsoft.DotNet.SDK.10 --exact --accept-source-agreements --accept-package-agreements --silent
            Write-Ok ".NET SDK $dotnetRequired installed"
            $script:Installed++
        }
    }
} elseif ($Check) {
    Write-Err ".NET SDK — NOT FOUND (need $dotnetRequired+)"
    $script:Missing++
} else {
    Write-Info "Installing .NET SDK $dotnetRequired..."
    winget install --id Microsoft.DotNet.SDK.10 --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok ".NET SDK $dotnetRequired installed"
    $script:Installed++
}

# -- Terraform -----------------------------------------------------------------

Write-Header "Terraform"

if (Test-Command "terraform") {
    $tfVer = ((terraform --version 2>$null) | Select-Object -First 1) -replace 'Terraform v', ''
    Write-Skip "Terraform $tfVer"
} elseif ($Check) {
    Write-Err "Terraform — NOT FOUND (need 1.5+)"
    $script:Missing++
} else {
    Write-Info "Installing Terraform..."
    winget install --id Hashicorp.Terraform --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "Terraform installed"
    $script:Installed++
}

# -- Azure CLI -----------------------------------------------------------------

Write-Header "Azure CLI"

if (Test-Command "az") {
    $azVer = (az version --query '"azure-cli"' -o tsv 2>$null)
    Write-Skip "Azure CLI $azVer"
} elseif ($Check) {
    Write-Err "Azure CLI — NOT FOUND (need 2.60+)"
    $script:Missing++
} else {
    Write-Info "Installing Azure CLI..."
    winget install --id Microsoft.AzureCLI --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "Azure CLI installed"
    $script:Installed++
}

# -- Docker Desktop ------------------------------------------------------------

Write-Header "Docker"

if (Test-Command "docker") {
    $dockerVer = ((docker --version 2>$null) -replace 'Docker version ', '' -replace ',.*', '').Trim()
    Write-Skip "Docker $dockerVer"

    # Check Docker Compose v2
    $composeCheck = docker compose version 2>$null
    if ($composeCheck) {
        $composeVer = ($composeCheck -replace '.*v', '').Trim()
        Write-Skip "Docker Compose $composeVer"
    } else {
        Write-Warn "Docker Compose v2 not available — update Docker Desktop"
        $script:Missing++
    }
} elseif ($Check) {
    Write-Err "Docker — NOT FOUND (need Docker Desktop 24+)"
    $script:Missing++
} else {
    Write-Info "Installing Docker Desktop..."
    winget install --id Docker.DockerDesktop --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "Docker Desktop installed"
    Write-Warn "A restart may be required. Open Docker Desktop after restart to complete setup."
    $script:Installed++
}

# -- VS Code ------------------------------------------------------------------

Write-Header "Visual Studio Code"

if (Test-Command "code") {
    $codeVer = ((code --version 2>$null) | Select-Object -First 1)
    Write-Skip "VS Code $codeVer"
} elseif ($Check) {
    Write-Err "VS Code — NOT FOUND"
    $script:Missing++
} else {
    Write-Info "Installing Visual Studio Code..."
    winget install --id Microsoft.VisualStudioCode --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "VS Code installed"
    $script:Installed++
}

# -- VS Code Extensions -------------------------------------------------------

Write-Header "VS Code Extensions"

$extensions = @(
    "ms-dotnettools.csdevkit"
    "hashicorp.terraform"
    "ms-azuretools.vscode-docker"
    "github.copilot"
)

if (Test-Command "code") {
    $installedExt = (code --list-extensions 2>$null) -join "`n"
    foreach ($ext in $extensions) {
        if ($installedExt -match [regex]::Escape($ext)) {
            Write-Skip "Extension: $ext"
        } elseif ($Check) {
            Write-Warn "Extension: $ext — not installed"
        } else {
            Write-Info "Installing VS Code extension: $ext..."
            code --install-extension $ext --force 2>$null | Out-Null
            Write-Ok "Extension: $ext"
            $script:Installed++
        }
    }
} else {
    Write-Warn "VS Code not available — skipping extension install"
}

# -- GitHub CLI (optional) -----------------------------------------------------

Write-Header "GitHub CLI (optional)"

if (Test-Command "gh") {
    $ghVer = ((gh --version 2>$null) | Select-Object -First 1) -replace '.*version ', '' -replace ' .*', ''
    Write-Skip "GitHub CLI $ghVer"
} elseif ($Check) {
    Write-Warn "GitHub CLI — not installed (optional)"
} else {
    Write-Info "Installing GitHub CLI..."
    winget install --id GitHub.cli --exact --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "GitHub CLI installed"
    $script:Installed++
}

# -- WSL check (informational) ------------------------------------------------

Write-Header "WSL (informational)"

$wslCheck = wsl --status 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "WSL is available"
} else {
    Write-Warn "WSL is not enabled. Docker Desktop can use Hyper-V instead."
    Write-Warn "To enable WSL: wsl --install (optional)"
}

# -- Summary -------------------------------------------------------------------

Write-Header "Summary"
Write-Host ""

if ($Check) {
    if ($script:Missing -eq 0) {
        Write-Host "  All tools are installed and ready." -ForegroundColor Green
    } else {
        Write-Host "  $($script:Missing) tool(s) missing." -ForegroundColor Yellow
        Write-Host "  Run .\setup-windows.ps1 as Administrator to install them." -ForegroundColor Yellow
    }
} else {
    Write-Host "  Setup complete." -ForegroundColor Green
    if ($script:Installed -gt 0) {
        Write-Host "  $($script:Installed) tool(s) were installed."
        Write-Host ""
        Write-Host "  IMPORTANT: Close and reopen your terminal for PATH changes to take effect." -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1. Open Docker Desktop if just installed (needs one-time setup)"
    Write-Host "    2. Clone the repo:  git clone <repo-url>; cd epcubegraph"
    Write-Host "    3. Deploy Azure:    cd infra; .\deploy.sh"
    Write-Host "    4. Deploy local:    cd local; .\deploy.sh"
    Write-Host ""
    Write-Host "  See DEPLOY.md for full deployment instructions."
}
Write-Host ""
