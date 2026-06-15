#!/usr/bin/env bash
# az_json — a single hardening primitive for invoking the Azure CLI without
# swallowing errors. Sourced by infra/validate-deployment.sh and its tests.
#
# Runs `az <args...>`, capturing stdout, stderr, and the exit code separately
# so callers can distinguish a real CLI/tool failure (non-zero exit, stderr
# populated) from a genuinely-absent resource (zero exit, empty stdout).
#
# Contract: specs/166-validate-pg-db-check/contracts/az-json.md
#
# Outputs (globals):
#   AZ_JSON_OUT  captured stdout (JSON / tsv / empty)
#   AZ_JSON_ERR  captured stderr (the real error on failure; empty on success)
#   AZ_JSON_RC   the az exit code
# Returns: the az exit code.
#
# Guarantees: never discards stderr to /dev/null (constitution rule 6); the
# exit status is always observable independent of stdout; compatible with
# `set -euo pipefail` (a non-zero az exit does not abort the caller). It is a
# pure getter — it does not touch PASS/FAIL/SKIP or print pass/fail/skip lines;
# outcome policy belongs to the call site.

az_json() {
  local _errfile _errexit_was_set
  _errfile=$(mktemp)
  # Remember whether the caller had `set -e` active so we can restore it
  # exactly — never forcing errexit onto a caller that did not have it.
  case $- in *e*) _errexit_was_set=1 ;; *) _errexit_was_set=0 ;; esac
  set +e
  AZ_JSON_OUT=$(az "$@" 2>"$_errfile")
  AZ_JSON_RC=$?
  [[ "$_errexit_was_set" == "1" ]] && set -e
  AZ_JSON_ERR=$(<"$_errfile")
  rm -f "$_errfile"
  return "$AZ_JSON_RC"
}
