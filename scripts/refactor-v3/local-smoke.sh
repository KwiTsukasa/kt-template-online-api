#!/usr/bin/env bash
set -Eeuo pipefail

base_url="http://127.0.0.1:48085"
timeout_seconds=10

# Prints command usage without performing an HTTP request.
print_help() {
  cat <<'EOF'
Usage: local-smoke.sh [options]

Read the bounded local runtime health endpoint and print runtime.service.

Options:
  --base-url URL              API base URL (default: http://127.0.0.1:48085)
  --timeout-seconds SECONDS   Timeout for curl and jq (default: 10)
  -h, --help                  Show this help
EOF
}

# Reports an invalid invocation and exits with the standard usage status.
usage_error() {
  printf 'Error: %s\n\n' "$1" >&2
  print_help >&2
  exit 2
}

# Returns success when a value is an integer greater than zero.
is_positive_integer() {
  [[ $1 =~ ^[1-9][0-9]*$ ]]
}

while (($# > 0)); do
  case "$1" in
    --base-url)
      (($# >= 2)) || usage_error "--base-url requires a value"
      base_url=$2
      shift 2
      ;;
    --timeout-seconds)
      (($# >= 2)) || usage_error "--timeout-seconds requires a value"
      timeout_seconds=$2
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    --)
      shift
      (($# == 0)) || usage_error "unexpected positional argument: $1"
      ;;
    *)
      usage_error "unknown argument: $1"
      ;;
  esac
done

[[ -n $base_url ]] || usage_error "--base-url cannot be empty"
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"
command -v timeout >/dev/null 2>&1 || usage_error "GNU timeout is required"
command -v curl >/dev/null 2>&1 || usage_error "curl is required"
command -v jq >/dev/null 2>&1 || usage_error "jq is required"

base_url=${base_url%/}
runtime_json=$(
  timeout --foreground --kill-after=2s "${timeout_seconds}s" \
    curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout "$timeout_seconds" \
    --max-time "$timeout_seconds" \
    "$base_url/health/runtime"
)
service=$(
  printf '%s\n' "$runtime_json" |
    timeout --foreground --kill-after=2s "${timeout_seconds}s" \
      jq -er '.service | select(. != null) | tostring | select(length > 0)'
)

printf 'runtime.service=%s\n' "$service"
