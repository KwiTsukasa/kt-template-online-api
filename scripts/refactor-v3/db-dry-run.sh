#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd -P)

database=""
host_name="127.0.0.1"
port=3306
user_name="root"
timeout_seconds=120
execute=false

# Prints command usage without accessing the database.
print_help() {
  cat <<'EOF'
Usage: db-dry-run.sh --database NAME [options]

Plan a disposable refactor-v3 database rebuild. The default is plan-only;
pass --execute explicitly to drop/recreate the database and load SQL files.

Required:
  --database NAME             Disposable target database

Options:
  --host HOST                 MySQL host (default: 127.0.0.1)
  --port PORT                 MySQL port (default: 3306)
  --user USER                 MySQL user (default: root)
  --timeout-seconds SECONDS   Timeout for each mysql command (default: 120)
  --execute                   Apply the destructive rebuild
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

# Prints the destructive scope and rollback/verification intent before writes.
print_plan() {
  printf 'mode=%s\n' "$([[ $execute == true ]] && printf execute || printf plan-only)"
  printf 'source.schema=%s\n' "$schema_file"
  printf 'source.seed=%s\n' "$seed_file"
  printf 'target=mysql://%s:%s/%s (user=%s)\n' "$host_name" "$port" "$database" "$user_name"
  printf 'rollback.backup=not-created (disposable dry-run target; recreate or restore separately)\n'
  printf 'verification.intent=execute %s after schema and seed load\n' "$verify_file"
}

# Runs one bounded mysql command without exposing credentials.
run_mysql_command() {
  timeout --foreground --kill-after=5s "${timeout_seconds}s" \
    "${mysql_base[@]}" "$@"
}

# Loads one SQL file into the target database with a bounded mysql process.
run_mysql_file() {
  local sql_file=$1
  timeout --foreground --kill-after=5s "${timeout_seconds}s" \
    "${mysql_base[@]}" "$database" <"$sql_file"
}

while (($# > 0)); do
  case "$1" in
    --database)
      (($# >= 2)) || usage_error "--database requires a value"
      database=$2
      shift 2
      ;;
    --host)
      (($# >= 2)) || usage_error "--host requires a value"
      host_name=$2
      shift 2
      ;;
    --port)
      (($# >= 2)) || usage_error "--port requires a value"
      port=$2
      shift 2
      ;;
    --user)
      (($# >= 2)) || usage_error "--user requires a value"
      user_name=$2
      shift 2
      ;;
    --timeout-seconds)
      (($# >= 2)) || usage_error "--timeout-seconds requires a value"
      timeout_seconds=$2
      shift 2
      ;;
    --execute)
      execute=true
      shift
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
[[ -n $host_name ]] || usage_error "--host cannot be empty"
[[ -n $user_name ]] || usage_error "--user cannot be empty"
if ! is_positive_integer "$port" || ((port > 65535)); then
  usage_error "--port must be between 1 and 65535"
fi
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"

schema_file="$PROJECT_ROOT/sql/refactor-v3/00-full-schema.sql"
seed_file="$PROJECT_ROOT/sql/refactor-v3/01-seed-core.sql"
verify_file="$PROJECT_ROOT/sql/refactor-v3/99-verify.sql"
[[ -f $schema_file ]] || usage_error "schema file does not exist: $schema_file"
[[ -f $seed_file ]] || usage_error "seed file does not exist: $seed_file"
[[ -f $verify_file ]] || usage_error "verification file does not exist: $verify_file"

print_plan
if [[ $execute != true ]]; then
  printf 'execution=skipped (pass --execute to apply)\n'
  exit 0
fi

command -v timeout >/dev/null 2>&1 || usage_error "GNU timeout is required"
command -v mysql >/dev/null 2>&1 || usage_error "mysql is required"
mysql_base=(
  mysql
  --default-character-set=utf8mb4
  -h "$host_name"
  -P "$port"
  -u "$user_name"
)
create_sql="DROP DATABASE IF EXISTS \`$database\`; CREATE DATABASE \`$database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

run_mysql_command --execute="$create_sql"
run_mysql_file "$schema_file"
run_mysql_file "$seed_file"
run_mysql_file "$verify_file"
