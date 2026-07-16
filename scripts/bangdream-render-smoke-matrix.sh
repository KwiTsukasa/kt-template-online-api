#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
NODE_RUNNER="$SCRIPT_DIR/bangdream-render-smoke-matrix.cjs"

out_dir=".kt-workspace/bangdream-smoke/matrix"
timeout_seconds=240
skip_external_player=false
child_pid=""

# Prints command usage without performing render or network work.
print_help() {
  cat <<'EOF'
Usage: bangdream-render-smoke-matrix.sh [options]

Run the bounded BangDream render matrix and write its JSON summary.

Options:
  --out-dir PATH              Matrix output directory
  --timeout-seconds SECONDS   Whole-process timeout (default: 240)
  --skip-external-player      Skip the external player lookup case
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

# Stops the matrix child started by this script and reaps it.
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

# Replays captured output while preserving stdout and stderr separation.
print_logs() {
  [[ -f $stdout_log ]] && cat -- "$stdout_log"
  [[ -f $stderr_log ]] && cat -- "$stderr_log" >&2
}

while (($# > 0)); do
  case "$1" in
    --out-dir)
      (($# >= 2)) || usage_error "--out-dir requires a value"
      out_dir=$2
      shift 2
      ;;
    --timeout-seconds)
      (($# >= 2)) || usage_error "--timeout-seconds requires a value"
      timeout_seconds=$2
      shift 2
      ;;
    --skip-external-player)
      skip_external_player=true
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

[[ -n $out_dir ]] || usage_error "--out-dir cannot be empty"
is_positive_integer "$timeout_seconds" || usage_error "--timeout-seconds must be a positive integer"

if [[ $out_dir = /* ]]; then
  resolved_out_dir=$out_dir
else
  resolved_out_dir="$PROJECT_ROOT/$out_dir"
fi
mkdir -p -- "$resolved_out_dir"

stdout_log="$resolved_out_dir/matrix.out.log"
stderr_log="$resolved_out_dir/matrix.err.log"
summary_file="$resolved_out_dir/matrix-summary.json"
rm -f -- "$stdout_log" "$stderr_log" "$summary_file"

trap cleanup_child EXIT
trap handle_interrupt INT
trap handle_termination TERM

cd -- "$PROJECT_ROOT"
TS_NODE_TRANSPILE_ONLY=true \
BANGDREAM_MATRIX_OUT_DIR=$resolved_out_dir \
BANGDREAM_MATRIX_SKIP_EXTERNAL_PLAYER=$skip_external_player \
  node -r ts-node/register -r tsconfig-paths/register "$NODE_RUNNER" \
  >"$stdout_log" 2>"$stderr_log" &
child_pid=$!

deadline=$((SECONDS + timeout_seconds))
timed_out=false
while kill -0 "$child_pid" 2>/dev/null; do
  if ((SECONDS >= deadline)); then
    timed_out=true
    cleanup_child
    break
  fi
  sleep 0.5
done

if [[ $timed_out == true ]]; then
  printf 'BangDream smoke matrix timed out after %s seconds and its process was killed.\n' "$timeout_seconds"
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
if [[ ! -f $summary_file ]]; then
  printf 'BangDream smoke matrix did not produce a summary file.\n'
  exit 1
fi
exit "$process_status"
