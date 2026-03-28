#!/usr/bin/env bash
# EP Cube Graph — macOS Development Environment Setup
# Supports macOS 15 (Sequoia) or higher.
#
# Installs all tools required to develop, build, and deploy the application.
# Safe to re-run — skips anything already installed.
#
# IMPORTANT: The canonical tool list lives in scripts/tools.json.
# When adding or changing tools, update tools.json first, then this script.
# CI runs scripts/validate-tool-sync.sh to catch drift.
#
# Usage:
#   ./setup-macos.sh           # Install everything
#   ./setup-macos.sh --check   # Check what's installed without changing anything

set -euo pipefail

# -- Colours (suppressed when piped) ------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
error() { echo -e "${RED}  ✗${NC} $*"; }
skip()  { echo -e "${GREEN}  ✓${NC} $* (already installed)"; }
header(){ echo ""; echo -e "${BOLD}── $* ──${NC}"; }

CHECK_ONLY=false
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=true

MISSING=0
INSTALLED=0

# -- Helpers -------------------------------------------------------------------

need_version() {
  # Usage: need_version <command> <display_name> <min_version>
  local cmd="$1" name="$2" min="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    local ver
    ver=$("$cmd" --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    skip "$name $ver"
    return 0
  else
    if $CHECK_ONLY; then
      error "$name — NOT FOUND (need $min+)"
      ((MISSING++))
    fi
    return 1
  fi
}

# -- macOS version check -------------------------------------------------------

header "System Check"

MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)

if (( MACOS_MAJOR < 15 )); then
  error "macOS $MACOS_VERSION detected. This script requires macOS 15 (Sequoia) or higher."
  exit 1
fi
ok "macOS $MACOS_VERSION"

# Verify Apple Silicon or Intel
ARCH=$(uname -m)
ok "Architecture: $ARCH"

# -- Xcode Command Line Tools -------------------------------------------------

header "Xcode Command Line Tools"

if xcode-select -p >/dev/null 2>&1; then
  skip "Xcode Command Line Tools"
else
  if $CHECK_ONLY; then
    error "Xcode Command Line Tools — NOT FOUND"
    ((MISSING++))
  else
    info "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo ""
    warn "A dialog will appear. Click 'Install', then re-run this script when done."
    exit 0
  fi
fi

# -- Homebrew ------------------------------------------------------------------

header "Homebrew"

if command -v brew >/dev/null 2>&1; then
  skip "Homebrew $(brew --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
else
  if $CHECK_ONLY; then
    error "Homebrew — NOT FOUND"
    ((MISSING++))
  else
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for this session
    if [[ "$ARCH" == "arm64" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    else
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
  fi
fi

if ! $CHECK_ONLY && command -v brew >/dev/null 2>&1; then
  info "Updating Homebrew..."
  brew update --quiet
fi

# -- Git -----------------------------------------------------------------------

header "Git"

if need_version git "Git" "2.0"; then
  : # already installed
elif ! $CHECK_ONLY; then
  info "Installing Git..."
  brew install git
  ok "Git installed"
  ((INSTALLED++))
fi

# -- .NET SDK ------------------------------------------------------------------

header ".NET SDK"

DOTNET_VERSION_REQUIRED="10.0"

if command -v dotnet >/dev/null 2>&1; then
  DOTNET_VER=$(dotnet --version 2>/dev/null || echo "0")
  if [[ "$DOTNET_VER" == 10.* ]]; then
    skip ".NET SDK $DOTNET_VER"
  else
    warn ".NET SDK $DOTNET_VER found, but $DOTNET_VERSION_REQUIRED.x required"
    if ! $CHECK_ONLY; then
      info "Installing .NET SDK $DOTNET_VERSION_REQUIRED..."
      brew install dotnet@10
      ok ".NET SDK $DOTNET_VERSION_REQUIRED installed"
      ((INSTALLED++))
    else
      ((MISSING++))
    fi
  fi
else
  if $CHECK_ONLY; then
    error ".NET SDK — NOT FOUND (need $DOTNET_VERSION_REQUIRED+)"
    ((MISSING++))
  else
    info "Installing .NET SDK $DOTNET_VERSION_REQUIRED..."
    brew install dotnet@10
    ok ".NET SDK $DOTNET_VERSION_REQUIRED installed"
    ((INSTALLED++))
  fi
fi

# -- Terraform -----------------------------------------------------------------

header "Terraform"

if need_version terraform "Terraform" "1.5"; then
  : # already installed
elif ! $CHECK_ONLY; then
  info "Installing Terraform..."
  brew tap hashicorp/tap
  brew install hashicorp/tap/terraform
  ok "Terraform installed"
  ((INSTALLED++))
fi

# -- Azure CLI -----------------------------------------------------------------

header "Azure CLI"

if command -v az >/dev/null 2>&1; then
  AZ_VER=$(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo "unknown")
  skip "Azure CLI $AZ_VER"
else
  if $CHECK_ONLY; then
    error "Azure CLI — NOT FOUND (need 2.60+)"
    ((MISSING++))
  else
    info "Installing Azure CLI..."
    brew install azure-cli
    ok "Azure CLI installed"
    ((INSTALLED++))
  fi
fi

# -- Docker Desktop ------------------------------------------------------------

header "Docker"

if command -v docker >/dev/null 2>&1; then
  DOCKER_VER=$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  skip "Docker $DOCKER_VER"

  # Verify Docker Compose v2
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_VER=$(docker compose version --short 2>/dev/null)
    skip "Docker Compose $COMPOSE_VER"
  else
    warn "Docker Compose v2 not available — update Docker Desktop"
    ((MISSING++))
  fi
else
  if $CHECK_ONLY; then
    error "Docker — NOT FOUND (need Docker Desktop 24+)"
    ((MISSING++))
  else
    info "Installing Docker Desktop..."
    brew install --cask docker
    ok "Docker Desktop installed"
    ((INSTALLED++))
    warn "Open Docker Desktop from Applications to complete setup."
  fi
fi

# -- Node.js -------------------------------------------------------------------

header "Node.js"

NODE_VERSION_REQUIRED="22"

if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>/dev/null | grep -oE '[0-9]+' | head -1)
  if [[ "$NODE_VER" -ge "$NODE_VERSION_REQUIRED" ]]; then
    skip "Node.js $(node --version)"
  else
    warn "Node.js v$NODE_VER found, but $NODE_VERSION_REQUIRED.x required"
    if ! $CHECK_ONLY; then
      info "Installing Node.js $NODE_VERSION_REQUIRED..."
      brew install node@22
      ok "Node.js $NODE_VERSION_REQUIRED installed"
      ((INSTALLED++))
    else
      ((MISSING++))
    fi
  fi
else
  if $CHECK_ONLY; then
    error "Node.js — NOT FOUND (need $NODE_VERSION_REQUIRED+)"
    ((MISSING++))
  else
    info "Installing Node.js $NODE_VERSION_REQUIRED..."
    brew install node@22
    ok "Node.js $NODE_VERSION_REQUIRED installed"
    ((INSTALLED++))
  fi
fi

# -- VS Code ------------------------------------------------------------------

header "Visual Studio Code"

if command -v code >/dev/null 2>&1; then
  VSCODE_VER=$(code --version 2>/dev/null | head -1)
  skip "VS Code $VSCODE_VER"
else
  if $CHECK_ONLY; then
    error "VS Code — NOT FOUND"
    ((MISSING++))
  else
    info "Installing Visual Studio Code..."
    brew install --cask visual-studio-code
    ok "VS Code installed"
    ((INSTALLED++))
  fi
fi

# -- VS Code Extensions -------------------------------------------------------

header "VS Code Extensions"

EXTENSIONS=(
  "ms-dotnettools.csdevkit"
  "hashicorp.terraform"
  "ms-azuretools.vscode-docker"
  "github.copilot"
)

if command -v code >/dev/null 2>&1; then
  INSTALLED_EXT=$(code --list-extensions 2>/dev/null || echo "")
  for ext in "${EXTENSIONS[@]}"; do
    if echo "$INSTALLED_EXT" | grep -qi "$ext"; then
      skip "Extension: $ext"
    else
      if $CHECK_ONLY; then
        warn "Extension: $ext — not installed"
      else
        info "Installing VS Code extension: $ext..."
        code --install-extension "$ext" --force >/dev/null 2>&1
        ok "Extension: $ext"
        ((INSTALLED++))
      fi
    fi
  done
else
  warn "VS Code not available — skipping extension install"
fi

# -- GitHub CLI (optional) -----------------------------------------------------

header "GitHub CLI (optional)"

if need_version gh "GitHub CLI" "2.0"; then
  : # already installed
elif ! $CHECK_ONLY; then
  info "Installing GitHub CLI..."
  brew install gh
  ok "GitHub CLI installed"
  ((INSTALLED++))
fi

# -- Summary -------------------------------------------------------------------

header "Summary"

echo ""
if $CHECK_ONLY; then
  if (( MISSING == 0 )); then
    echo -e "${GREEN}${BOLD}All tools are installed and ready.${NC}"
  else
    echo -e "${YELLOW}${BOLD}$MISSING tool(s) missing.${NC} Run ${BOLD}./setup-macos.sh${NC} to install them."
  fi
else
  echo -e "${GREEN}${BOLD}Setup complete.${NC}"
  if (( INSTALLED > 0 )); then
    echo -e "  $INSTALLED tool(s) were installed."
  fi
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo -e "    1. Open Docker Desktop if just installed (needs one-time setup)"
  echo -e "    2. Clone the repo:  ${BOLD}git clone <repo-url> && cd epcubegraph${NC}"
  echo -e "    3. Deploy Azure:    ${BOLD}cd infra && ./deploy.sh${NC}"
  echo -e "    4. Deploy local:    ${BOLD}cd local && ./deploy.sh${NC}"
  echo ""
  echo -e "  See ${BOLD}DEPLOY.md${NC} for full deployment instructions."
fi
echo ""
