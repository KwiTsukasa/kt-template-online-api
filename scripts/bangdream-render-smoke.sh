#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
NODE_RUNNER="$SCRIPT_DIR/bangdream-render-smoke.cjs"

operation_key="bangdream.event.search"
text="50"
displayed_server_list="cn jp"
out_file=".kt-workspace/bangdream-smoke/bangdream-smoke.jpg"
timeout_seconds=45
expected_image_count=0
use_easy_bg=false
child_pid=""

# Prints command usage without performing render or network work.
print_help() {
  cat <<'EOF'
Usage: bangdream-render-smoke.sh [options]

Run one bounded BangDream render smoke and write decoded image output.

Options:
  --operation-key KEY          Operation key (default: bangdream.event.search)
  --text TEXT                 Operation input text (default: 50)
  --displayed-server-list LIST
                              Displayed servers (default: "cn jp")
  --out-file PATH             Image output path
  --timeout-seconds SECONDS   Whole-process timeout (default: 45)
  --expected-image-count N    Require this imageCount when greater than zero
  --use-easy-bg               Enable the easy background renderer
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

# Returns success when a value is a non-negative integer.
is_non_negative_integer() {
  [[ $1 =~ ^[0-9]+$ ]]
}

# Stops the render child started by this script and reaps it.
cleanup_child() {
  if [[ -n ${child_pid:-} ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$child_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
    wait "$child_pid" 2>/dev/null || true
  fi
  child_pid=""
}

# Converts an interrupt signal into a deterministic exit after cleanup.
# shellcheck disable=SC2317 # Invoked indirectly by trap.
handle_interrupt() {
  cleanup_child
  exit 130
}

# Converts a termination signal into a deterministic exit after cleanup.
# shellcheck disable=SC2317 # Invoked indirectly by trap.
handle_termination() {
  cleanup_child
  exit 143
}

# Returns success after the primary image and completion JSON are durable.
smoke_completed() {
  [[ -s $resolved_out_file && -f $stdout_log ]] && grep -Fq '"bytes"' "$stdout_log"
}

# Replays captured output while preserving stdout and stderr separation.
print_logs() {
  [[ -f $stdout_log ]] && cat -- "$stdout_log"
  [[ -f $stderr_log ]] && cat -- "$stderr_log" >&2
}

while (($# > 0)); do
  case "$1" in
    --operation-key)
      (($# >= 2)) || usage_error "--operation-key requires a value"
      operation_key=$2
      shift 2
      ;;
    --text)
      (($# >= 2)) || usage_error "--text requires a value"
      text=$2
      shift 2
      ;;
    --displayed-server-list)
      (($# >= 2)) || usage_error "--displayed-server-list requires a value"
      displayed_server_list=$2
      shift 2
      ;;
    --out-file)
      (($# >= 2)) || usage_error "--out-file requires a value"
      out_file=$2
      shift 2
      ;;
    --timeout-seconds)
      (($# >= 2)) || usage_error "--timeout-seconds requires a value"
      timeout_seconds=$2
      shift 2
      ;;
    --expected-image-count)
      (($# >= 2)) || usage_error "--expected-image-count requires a value"
      expected_image_count=$2
      shift 2
      ;;
    --use-easy-bg)
      use_easy_bg=true
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

[[ -n $operation_key ]] || usage_error "--operation-key cannot be empty"
[[ -n $out_file ]] || usage_error "--out-file cannot be empty"
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"
is_non_negative_integer "$expected_image_count" || usage_error "--expected-image-count must be a non-negative integer"

if [[ $out_file = /* ]]; then
  resolved_out_file=$out_file
else
  resolved_out_file="$PROJECT_ROOT/$out_file"
fi
out_dir=$(dirname -- "$resolved_out_file")
mkdir -p -- "$out_dir"

log_dir="$PROJECT_ROOT/.kt-workspace/bangdream-smoke"
mkdir -p -- "$log_dir"
output_filename=$(basename -- "$resolved_out_file")
log_name=${output_filename%.*}
if [[ $output_filename == *.* ]]; then
  out_extension=.${output_filename##*.}
else
  out_extension=""
fi
stdout_log="$log_dir/$log_name.out.log"
stderr_log="$log_dir/$log_name.err.log"
rm -f -- "$stdout_log" "$stderr_log" "$resolved_out_file"
shopt -s nullglob
generated_images=("$out_dir"/"$log_name"-*"$out_extension")
shopt -u nullglob
if ((${#generated_images[@]} > 0)); then
  rm -f -- "${generated_images[@]}"
fi

trap cleanup_child EXIT
trap handle_interrupt INT
trap handle_termination TERM

cd -- "$PROJECT_ROOT"
TS_NODE_TRANSPILE_ONLY=true \
BANGDREAM_OPERATION_KEY=$operation_key \
BANGDREAM_TEXT=$text \
BANGDREAM_DISPLAYED_SERVER_LIST=$displayed_server_list \
BANGDREAM_OUT_FILE=$resolved_out_file \
BANGDREAM_EXPECTED_IMAGE_COUNT=$expected_image_count \
BANGDREAM_USE_EASY_BG=$use_easy_bg \
  node -r ts-node/register -r tsconfig-paths/register "$NODE_RUNNER" \
  >"$stdout_log" 2>"$stderr_log" &
child_pid=$!

deadline=$((SECONDS + timeout_seconds))
completed_by_output=false
timed_out=false
while kill -0 "$child_pid" 2>/dev/null; do
  if smoke_completed; then
    completed_by_output=true
    cleanup_child
    break
  fi
  if ((SECONDS >= deadline)); then
    timed_out=true
    cleanup_child
    break
  fi
  sleep 0.5
done

if [[ $timed_out == true ]]; then
  printf 'BangDream smoke timed out after %s seconds and its process was killed.\n' "$timeout_seconds"
  print_logs
  exit 124
fi

process_status=0
if [[ -n $child_pid ]]; then
  if wait "$child_pid"; then
    process_status=0
  else
    process_status=$?
  fi
  child_pid=""
fi

print_logs
if [[ $completed_by_output == true ]]; then
  printf 'BangDream smoke output completed; its lingering process was cleaned up.\n'
  exit 0
fi
if ! smoke_completed; then
  printf 'BangDream smoke did not produce an image file.\n'
  exit 1
fi
exit "$process_status"
