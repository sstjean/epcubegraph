#!/usr/bin/env bash
# Validates that setup-macos.sh, setup-windows.ps1, and DEPLOY.md all stay
# in sync with the canonical tool list in scripts/tools.json.
#
# Run locally:  ./scripts/validate-tool-sync.sh
# Run in CI:    (automatic — see .github/workflows/ci.yml)
#
# Exit code 0 = all in sync, 1 = drift detected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

MANIFEST="$SCRIPT_DIR/tools.json"
MACOS_SCRIPT="$SCRIPT_DIR/setup-macos.sh"
WINDOWS_SCRIPT="$SCRIPT_DIR/setup-windows.ps1"
DEPLOY_DOC="$REPO_ROOT/DEPLOY.md"
DEVELOP_DOC="$REPO_ROOT/DEVELOP.md"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BOLD='\033[1m'; NC='\033[0m'

ERRORS=0

ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
fail()  { echo -e "${RED}  ✗${NC} $*"; ((ERRORS++)); }
info()  { echo -e "${YELLOW}  →${NC} $*"; }
header(){ echo ""; echo -e "${BOLD}── $* ──${NC}"; }

# ---------------------------------------------------------------------------
# Requires: python3 (available on macOS and GitHub Actions runners)
# ---------------------------------------------------------------------------

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run this validation script."
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract tool data from manifest
# ---------------------------------------------------------------------------

header "Loading manifest: scripts/tools.json"

# Extract tool CLI names (required tools only)
REQUIRED_TOOLS=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    if t['required']:
        print(t['name'])
")

# All tools (including optional)
ALL_TOOLS=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    print(t['name'])
")

# Brew package IDs
BREW_PACKAGES=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    install = t.get('install', {})
    pkg = install.get('brew', install.get('brew_cask', ''))
    if pkg:
        print(pkg)
")

# Winget package IDs
WINGET_PACKAGES=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    pkg = t.get('install', {}).get('winget', '')
    if pkg:
        print(pkg)
")

# VS Code extensions
EXTENSIONS=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for ext in data['vscodeExtensions']:
    print(ext)
")

tool_count=$(echo "$ALL_TOOLS" | wc -l | tr -d ' ')
ext_count=$(echo "$EXTENSIONS" | wc -l | tr -d ' ')
ok "Manifest loaded: $tool_count tools, $ext_count VS Code extensions"

# ---------------------------------------------------------------------------
# Check setup-macos.sh
# ---------------------------------------------------------------------------

header "Checking setup-macos.sh"

for tool in $ALL_TOOLS; do
  if grep -q "$tool" "$MACOS_SCRIPT"; then
    ok "Tool '$tool' referenced"
  else
    fail "Tool '$tool' missing from setup-macos.sh"
  fi
done

for pkg in $BREW_PACKAGES; do
  if grep -q "$pkg" "$MACOS_SCRIPT"; then
    ok "Brew package '$pkg' referenced"
  else
    fail "Brew package '$pkg' missing from setup-macos.sh"
  fi
done

for ext in $EXTENSIONS; do
  if grep -q "$ext" "$MACOS_SCRIPT"; then
    ok "Extension '$ext' referenced"
  else
    fail "Extension '$ext' missing from setup-macos.sh"
  fi
done

# ---------------------------------------------------------------------------
# Check setup-windows.ps1
# ---------------------------------------------------------------------------

header "Checking setup-windows.ps1"

for tool in $ALL_TOOLS; do
  if grep -qi "$tool" "$WINDOWS_SCRIPT"; then
    ok "Tool '$tool' referenced"
  else
    fail "Tool '$tool' missing from setup-windows.ps1"
  fi
done

for pkg in $WINGET_PACKAGES; do
  if grep -q "$pkg" "$WINDOWS_SCRIPT"; then
    ok "Winget package '$pkg' referenced"
  else
    fail "Winget package '$pkg' missing from setup-windows.ps1"
  fi
done

for ext in $EXTENSIONS; do
  if grep -q "$ext" "$WINDOWS_SCRIPT"; then
    ok "Extension '$ext' referenced"
  else
    fail "Extension '$ext' missing from setup-windows.ps1"
  fi
done

# ---------------------------------------------------------------------------
# Check DEVELOP.md
# ---------------------------------------------------------------------------

header "Checking DEVELOP.md"

# Required tools should appear in the tool table
for tool in $REQUIRED_TOOLS; do
  # Map CLI names to display names for doc checking
  display_name=$(python3 -c "
import json
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    if t['name'] == '$tool':
        print(t['displayName'])
        break
")
  if grep -qi "$display_name" "$DEVELOP_DOC"; then
    ok "'$display_name' documented"
  else
    fail "'$display_name' ($tool) missing from DEVELOP.md"
  fi
done

# Check that versions in DEVELOP.md match manifest
for tool in $ALL_TOOLS; do
  min_ver=$(python3 -c "
import json
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    if t['name'] == '$tool':
        print(t['minVersion'])
        break
")
  if grep -q "$min_ver" "$DEVELOP_DOC"; then
    ok "Version '$min_ver' for '$tool' found in DEVELOP.md"
  else
    # Only warn — versions may appear in different format
    info "Version '$min_ver' for '$tool' not found verbatim in DEVELOP.md (check manually)"
  fi
done

# ---------------------------------------------------------------------------
# Check DEPLOY.md
# ---------------------------------------------------------------------------

header "Checking DEPLOY.md"

if [ -f "$DEPLOY_DOC" ]; then
  # Required tools needed for deployment should appear in DEPLOY.md
  for tool in $REQUIRED_TOOLS; do
    display_name=$(python3 -c "
import json
with open('$MANIFEST') as f:
    data = json.load(f)
for t in data['tools']:
    if t['name'] == '$tool':
        print(t['displayName'])
        break
")
    if grep -qi "$display_name" "$DEPLOY_DOC"; then
      ok "'$display_name' documented in DEPLOY.md"
    else
      # Only warn — DEPLOY.md may only list deployment-specific tools
      info "'$display_name' ($tool) not found in DEPLOY.md (may be optional)"
    fi
  done
else
  info "DEPLOY.md not found — skipping"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

header "Summary"
echo ""

if (( ERRORS == 0 )); then
  echo -e "${GREEN}${BOLD}All files are in sync with scripts/tools.json${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}$ERRORS inconsistency(ies) found.${NC}"
  echo -e "Update the affected files to match ${BOLD}scripts/tools.json${NC}."
  exit 1
fi
