#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export LC_ALL=C

profile='media-governance-backup-restore-v1'
source_database=''
restore_database=''
output_directory=''
timeout_seconds=120
execute=false
restore_created=false

tables=(
  media_governance_task
  media_governance_unit
  media_governance_source
  media_governance_descriptor_revision
  media_governance_run
  media_governance_event
  media_governance_agent_session
  media_governance_metadata_exception
  media_governance_operator_decision
  media_governance_outbox
  media_governance_series
  media_governance_series_external_ref
  media_governance_season
  media_governance_episode
  media_governance_task_episode_binding
  media_governance_rss_subscription
  media_governance_rss_item
)

print_help() {
  cat <<'EOF'
Usage: backup-restore-drill.sh --source-database NAME --restore-database NAME --output-directory PATH [options]

Back up the seventeen media-governance tables, restore them into a new isolated
database, compare row counts plus Task/Run/Event identity snapshots, and remove
only the isolated database created by this run. The default mode is plan-only.

Required:
  --source-database NAME      Read-only source database
  --restore-database NAME     New database matching kt_media_governance_restore_*
  --output-directory PATH     Root-only directory for dump and evidence

Options:
  --timeout-seconds SECONDS   Timeout for each client command (default: 120)
  --execute                   Execute the isolated drill
  -h, --help                  Show this help

Credentials come from mysql client defaults and are never printed.
EOF
}

usage_error() {
  printf 'Error: %s\n\n' "$1" >&2
  print_help >&2
  exit 2
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

is_positive_integer() {
  [[ $1 =~ ^[1-9][0-9]*$ ]]
}

is_database_name() {
  [[ $1 =~ ^[A-Za-z0-9_]+$ ]]
}

while (($# > 0)); do
  case "$1" in
    --source-database)
      (($# >= 2)) || usage_error '--source-database requires a value'
      source_database=$2
      shift 2
      ;;
    --restore-database)
      (($# >= 2)) || usage_error '--restore-database requires a value'
      restore_database=$2
      shift 2
      ;;
    --output-directory)
      (($# >= 2)) || usage_error '--output-directory requires a value'
      output_directory=$2
      shift 2
      ;;
    --timeout-seconds)
      (($# >= 2)) || usage_error '--timeout-seconds requires a value'
      timeout_seconds=$2
      shift 2
      ;;
    --execute)
      execute=true
      shift
      ;;
    -h | --help)
      print_help
      exit 0
      ;;
    --)
      shift
      ;;
    *)
      usage_error "unknown argument: $1"
      ;;
  esac
done

is_database_name "$source_database" || usage_error '--source-database must match ^[A-Za-z0-9_]+$'
[[ $restore_database =~ ^kt_media_governance_restore_[A-Za-z0-9_]+$ ]] ||
  usage_error '--restore-database must match ^kt_media_governance_restore_[A-Za-z0-9_]+$'
[[ $source_database != "$restore_database" ]] || usage_error 'source and restore databases must differ'
[[ -n $output_directory ]] || usage_error '--output-directory is required'
[[ $output_directory != *$'\n'* && $output_directory != *$'\r'* && $output_directory != *$'\t'* ]] ||
  usage_error '--output-directory cannot contain control characters'
is_positive_integer "$timeout_seconds" || usage_error '--timeout-seconds must be a positive integer'

printf 'profile=%s\n' "$profile"
printf 'mode=%s\n' "$([[ $execute == true ]] && printf execute || printf plan-only)"
printf 'source.database=%s (read-only)\n' "$source_database"
printf 'restore.database=%s (new isolated database)\n' "$restore_database"
printf 'tables=%s\n' "${tables[*]}"
printf 'writeBoundaries=media:0,cloud:0,ui:0,sourceDatabase:0,positiveFixtures:0\n'

if [[ $execute != true ]]; then
  printf 'execution=skipped (pass --execute to run the isolated drill)\n'
  exit 0
fi

mysql_bin=${KT_MEDIA_MYSQL_BIN:-mysql}
mysqldump_bin=${KT_MEDIA_MYSQLDUMP_BIN:-mysqldump}
sha256sum_bin=${KT_MEDIA_SHA256SUM_BIN:-sha256sum}

command -v timeout >/dev/null 2>&1 || usage_error 'GNU timeout is required'
command -v awk >/dev/null 2>&1 || usage_error 'awk is required'
mysql_bin=$(command -v "$mysql_bin") || usage_error 'mysql client is required'
mysqldump_bin=$(command -v "$mysqldump_bin") || usage_error 'mysqldump is required'
sha256sum_bin=$(command -v "$sha256sum_bin") || usage_error 'sha256sum is required'

run_mysql_server() {
  timeout --foreground --kill-after=5s "${timeout_seconds}s" \
    "$mysql_bin" --batch --raw --skip-column-names "--execute=$1"
}

run_mysql_query() {
  local database=$1
  local query=$2
  timeout --foreground --kill-after=5s "${timeout_seconds}s" \
    "$mysql_bin" --batch --raw --skip-column-names "--database=$database" "--execute=$query"
}

drop_created_restore_database() {
  local exit_code=$?
  trap - EXIT
  if [[ $restore_created == true ]]; then
    run_mysql_server "DROP DATABASE IF EXISTS \`$restore_database\`;" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

trap drop_created_restore_database EXIT

expected_table_count=${#tables[@]}
table_literals=$(printf "'%s'," "${tables[@]}")
table_literals=${table_literals%,}
source_table_count=$(run_mysql_query "$source_database" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ($table_literals);")
[[ $source_table_count == "$expected_table_count" ]] ||
  fail "source media-governance table count is $source_table_count, expected $expected_table_count"

restore_exists=$(run_mysql_server "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$restore_database';")
[[ $restore_exists == 0 ]] || fail 'restore database already exists'

mkdir -p -- "$output_directory"
output_directory=$(cd -- "$output_directory" && pwd -P)
stamp=$(date +%Y%m%d-%H%M%S)
batch_directory="$output_directory/$profile-$stamp-$$"
mkdir -- "$batch_directory"
dump_path="$batch_directory/media-governance.sql"

file_sha256() {
  "$sha256sum_bin" "$1" | awk '{print $1}'
}

write_identity_snapshot() {
  local database=$1
  local prefix=$2
  local table count

  : >"$prefix.table-counts.tsv"
  for table in "${tables[@]}"; do
    count=$(run_mysql_query "$database" "SELECT COUNT(*) FROM \`$table\`;")
    [[ $count =~ ^[0-9]+$ ]] || fail "invalid row count for $table"
    printf '%s\t%s\n' "$table" "$count" >>"$prefix.table-counts.tsv"
  done

  run_mysql_query "$database" 'SELECT id, revision, stage, run_state, IFNULL(active_run_id, ""), input_snapshot_sha256, IFNULL(sealed_plan_sha256, ""), IFNULL(closed_mode, "") FROM media_governance_task ORDER BY id;' >"$prefix.task.tsv"
  run_mysql_query "$database" 'SELECT id, task_id, task_revision, action, status, replay_key, input_snapshot_sha256, IFNULL(plan_sha256, ""), IFNULL(evidence_sha256, "") FROM media_governance_run ORDER BY id;' >"$prefix.run.tsv"
  run_mysql_query "$database" 'SELECT event_id, task_id, IFNULL(run_id, ""), sequence, type, stage, run_state FROM media_governance_event ORDER BY task_id, IFNULL(run_id, ""), sequence, event_id;' >"$prefix.event.tsv"
  run_mysql_query "$database" 'SELECT id, canonical_provider, canonical_provider_id, title, release_year, revision, status FROM media_governance_series ORDER BY id;' >"$prefix.series.tsv"
  run_mysql_query "$database" 'SELECT id, series_id, season_number, episode_start, episode_count, title, IFNULL(release_year, ""), status FROM media_governance_season ORDER BY series_id, season_number;' >"$prefix.season.tsv"
  run_mysql_query "$database" 'SELECT id, series_id, season_id, season_number, episode_number, status FROM media_governance_episode ORDER BY series_id, season_number, episode_number;' >"$prefix.episode.tsv"
  run_mysql_query "$database" 'SELECT id, series_id, season_id, episode_id, task_id, IFNULL(source_id, ""), binding_role FROM media_governance_task_episode_binding ORDER BY series_id, season_id, episode_id, task_id;' >"$prefix.binding.tsv"
  run_mysql_query "$database" 'SELECT id, series_id, season_id, feed_url_sha256, enabled, revision, status, IFNULL(last_polled_at, ""), IFNULL(next_poll_at, "") FROM media_governance_rss_subscription ORDER BY id;' >"$prefix.rss-subscription.tsv"
  run_mysql_query "$database" 'SELECT id, subscription_id, item_key_sha256, IFNULL(info_hash, ""), IFNULL(episode_number, ""), state, IFNULL(task_id, ""), IFNULL(source_id, "") FROM media_governance_rss_item ORDER BY subscription_id, item_key_sha256;' >"$prefix.rss-item.tsv"
}

source_before_prefix="$batch_directory/source-before"
source_prefix="$batch_directory/source-after"
restore_prefix="$batch_directory/restored"
write_identity_snapshot "$source_database" "$source_before_prefix"

timeout --foreground --kill-after=5s "${timeout_seconds}s" \
  "$mysqldump_bin" \
  --set-gtid-purged=OFF \
  --single-transaction \
  --quick \
  --skip-lock-tables \
  --no-tablespaces \
  --hex-blob \
  --default-character-set=utf8mb4 \
  "--result-file=$dump_path" \
  "$source_database" \
  "${tables[@]}"

[[ -s $dump_path ]] || fail 'media-governance dump is empty'
write_identity_snapshot "$source_database" "$source_prefix"
for snapshot in table-counts task run event series season episode binding rss-subscription rss-item; do
  [[ $(file_sha256 "$source_before_prefix.$snapshot.tsv") == $(file_sha256 "$source_prefix.$snapshot.tsv") ]] ||
    fail "source $snapshot snapshot changed during backup window"
done
dump_sha256=$(file_sha256 "$dump_path")
[[ $(file_sha256 "$dump_path") == "$dump_sha256" ]] || fail 'dump SHA-256 changed before restore'

run_mysql_server "CREATE DATABASE \`$restore_database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
restore_created=true
timeout --foreground --kill-after=5s "${timeout_seconds}s" \
  "$mysql_bin" --default-character-set=utf8mb4 "--database=$restore_database" <"$dump_path"

write_identity_snapshot "$restore_database" "$restore_prefix"

for snapshot in table-counts task run event series season episode binding rss-subscription rss-item; do
  [[ $(file_sha256 "$source_prefix.$snapshot.tsv") == $(file_sha256 "$restore_prefix.$snapshot.tsv") ]] ||
    fail "restored $snapshot snapshot differs from source"
done

table_counts_sha256=$(file_sha256 "$source_prefix.table-counts.tsv")
task_snapshot_sha256=$(file_sha256 "$source_prefix.task.tsv")
run_snapshot_sha256=$(file_sha256 "$source_prefix.run.tsv")
event_snapshot_sha256=$(file_sha256 "$source_prefix.event.tsv")
series_snapshot_sha256=$(file_sha256 "$source_prefix.series.tsv")
season_snapshot_sha256=$(file_sha256 "$source_prefix.season.tsv")
episode_snapshot_sha256=$(file_sha256 "$source_prefix.episode.tsv")
binding_snapshot_sha256=$(file_sha256 "$source_prefix.binding.tsv")
rss_subscription_snapshot_sha256=$(file_sha256 "$source_prefix.rss-subscription.tsv")
rss_item_snapshot_sha256=$(file_sha256 "$source_prefix.rss-item.tsv")

run_mysql_server "DROP DATABASE \`$restore_database\`;"
restore_created=false

manifest_path="$batch_directory/evidence.json"
cat >"$manifest_path" <<EOF
{
  "schemaVersion": "1.0.0",
  "profile": "$profile",
  "sourceDatabase": "$source_database",
  "restoreDatabase": "$restore_database",
  "tableCount": $expected_table_count,
  "dump": {
    "relativePath": "media-governance.sql",
    "sha256": "$dump_sha256"
  },
  "snapshots": {
    "tableCountsSha256": "$table_counts_sha256",
    "taskSha256": "$task_snapshot_sha256",
    "runSha256": "$run_snapshot_sha256",
    "eventSha256": "$event_snapshot_sha256",
    "seriesSha256": "$series_snapshot_sha256",
    "seasonSha256": "$season_snapshot_sha256",
    "episodeSha256": "$episode_snapshot_sha256",
    "bindingSha256": "$binding_snapshot_sha256",
    "rssSubscriptionSha256": "$rss_subscription_snapshot_sha256",
    "rssItemSha256": "$rss_item_snapshot_sha256"
  },
  "restoreVerified": true,
  "restoreDatabaseDropped": true,
  "writeBoundaries": {
    "media": 0,
    "cloud": 0,
    "ui": 0,
    "sourceDatabase": 0,
    "positiveFixtures": 0
  }
}
EOF

printf 'restore=verified\n'
printf 'cleanup.restoreDatabaseDropped=true\n'
printf 'evidence=%s\n' "$manifest_path"
