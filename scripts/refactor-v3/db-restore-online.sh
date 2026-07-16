#!/usr/bin/env bash
set -Eeuo pipefail

database=""
backup_file=""
timeout_seconds=300
execute=false

# Prints command usage without accessing the database.
print_help() {
  cat <<'EOF'
Usage: db-restore-online.sh --database NAME --backup-file PATH [options]

Plan an online database restore. The default is plan-only; pass --execute
explicitly to drop/recreate the database and load the selected backup.
MySQL connection and credentials come from mysql client defaults.

Required:
  --database NAME             Target database
  --backup-file PATH          Existing SQL backup to restore

Options:
  --timeout-seconds SECONDS   Timeout for each mysql command (default: 300)
  --execute                   Apply the destructive restore
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
  printf 'source.backup=%s\n' "$resolved_backup_file"
  printf 'target.database=%s (connection=mysql client defaults)\n' "$database"
  printf 'rollback.backup=%s\n' "$resolved_backup_file"
  printf 'verification.intent=confirm restore command success, then run the project post-restore verification queries\n'
}

# Runs one bounded mysql command without exposing credentials.
run_mysql_command() {
  timeout --foreground --kill-after=5s "${timeout_seconds}s" mysql "$@"
}

# Loads the selected backup with a bounded mysql process.
run_mysql_restore() {
  timeout --foreground --kill-after=5s "${timeout_seconds}s" \
    mysql --default-character-set=utf8mb4 "$database" <"$resolved_backup_file"
}

while (($# > 0)); do
  case "$1" in
    --database)
      (($# >= 2)) || usage_error "--database requires a value"
      database=$2
      shift 2
      ;;
    --backup-file)
      (($# >= 2)) || usage_error "--backup-file requires a value"
      backup_file=$2
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
[[ -n $backup_file ]] || usage_error "--backup-file is required"
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"
[[ -f $backup_file ]] || usage_error "backup file does not exist: $backup_file"
backup_directory=$(cd -- "$(dirname -- "$backup_file")" && pwd -P)
resolved_backup_file="$backup_directory/$(basename -- "$backup_file")"

print_plan
if [[ $execute != true ]]; then
  printf 'execution=skipped (pass --execute to apply)\n'
  exit 0
fi

command -v timeout >/dev/null 2>&1 || usage_error "GNU timeout is required"
command -v mysql >/dev/null 2>&1 || usage_error "mysql is required"
create_sql="DROP DATABASE IF EXISTS \`$database\`; CREATE DATABASE \`$database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

run_mysql_command --execute="$create_sql"
run_mysql_restore
