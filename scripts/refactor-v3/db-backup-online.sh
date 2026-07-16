#!/usr/bin/env bash
set -Eeuo pipefail

database=""
output_directory=""
timeout_seconds=300

# Prints command usage without accessing the database.
print_help() {
  cat <<'EOF'
Usage: db-backup-online.sh --database NAME --output-directory PATH [options]

Create a bounded logical MySQL backup and print its absolute output path.
MySQL credentials are resolved by the mysql client and are never printed.

Required:
  --database NAME             Database name (letters, digits, and underscores)
  --output-directory PATH     Directory for the timestamped SQL backup

Options:
  --timeout-seconds SECONDS   mysqldump timeout (default: 300)
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
    --database)
      (($# >= 2)) || usage_error "--database requires a value"
      database=$2
      shift 2
      ;;
    --output-directory)
      (($# >= 2)) || usage_error "--output-directory requires a value"
      output_directory=$2
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

[[ $database =~ ^[A-Za-z0-9_]+$ ]] || usage_error "--database must match ^[A-Za-z0-9_]+$"
[[ -n $output_directory ]] || usage_error "--output-directory is required"
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"
command -v timeout >/dev/null 2>&1 || usage_error "GNU timeout is required"
command -v mysqldump >/dev/null 2>&1 || usage_error "mysqldump is required"

mkdir -p -- "$output_directory"
output_directory=$(cd -- "$output_directory" && pwd -P)
stamp=$(date +%Y%m%d-%H%M%S)
target="$output_directory/$database-refactor-v3-$stamp.sql"

timeout --foreground --kill-after=5s "${timeout_seconds}s" \
  mysqldump \
  --set-gtid-purged=OFF \
  --single-transaction \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  "--result-file=$target" \
  "$database"

printf '%s\n' "$target"
