#!/bin/sh
set -eu

MARKER=/ci/napcat-desktop-cn/fork-artifact.json
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

wait_for_absent() {
  path="$1"
  timeout_seconds="$2"
  elapsed=0
  while [ -e "$path" ] && [ "$elapsed" -lt "$timeout_seconds" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  test ! -e "$path"
}

locale -a | grep -i '^zh_CN.utf8$'
locale | grep 'LANG=zh_CN.UTF-8'
test "$(cat /etc/timezone)" = "Asia/Shanghai"
fc-match "Noto Sans CJK SC" | grep -E 'Noto|WenQuanYi|wqy'
test "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-}" = "XDG_CONFIG_HOME=/app/.config"
test "XDG_CACHE_HOME=${XDG_CACHE_HOME:-}" = "XDG_CACHE_HOME=/app/.cache"
test "XDG_DATA_HOME=${XDG_DATA_HOME:-}" = "XDG_DATA_HOME=/app/.local/share"
wait_for_absent /.dockerenv 10
grep -q '^0::/$' /proc/1/cgroup

test -s "$MARKER"
grep -q '"upstreamBaseCommit"' "$MARKER"
grep -q '"forkCommit"' "$MARKER"
grep -q '"napcatMjsSha256"' "$MARKER"
test -s /app/NapCat.Shell.zip
test -s /ci/napcat-desktop-cn/NapCat.Shell.zip.sha256

unzip -q /app/NapCat.Shell.zip -d "$TMP_DIR"
test -s "$TMP_DIR/napcat.mjs"

EXPECTED_MJS_SHA="$(sed -n 's/.*"napcatMjsSha256"[[:space:]]*:[[:space:]]*"\([a-f0-9]\{64\}\)".*/\1/p' "$MARKER")"
ACTUAL_MJS_SHA="$(sha256sum "$TMP_DIR/napcat.mjs" | awk '{print $1}')"
test "$EXPECTED_MJS_SHA" = "$ACTUAL_MJS_SHA"

grep -R -q 'getQQLoginRuntimeState' "$TMP_DIR"
grep -R -q 'qrcodeRevision' "$TMP_DIR"
grep -R -q 'needsLoginServiceReset' "$TMP_DIR"

grep -q 'KT device profile patch defaults' /app/entrypoint.sh
grep -q 'NAPCAT_REQUIRE_DEVICE_PROFILE' /app/entrypoint.sh
grep -q '/proc/1/cmdline' /app/entrypoint.sh
grep -q '/proc/1/sched' /app/entrypoint.sh
grep -q '/proc/1/status' /app/entrypoint.sh
grep -q '/proc/1/stat' /app/entrypoint.sh
grep -q '/proc/1/mountinfo' /app/entrypoint.sh
grep -q '/proc/self/mountinfo' /app/entrypoint.sh
grep -q '/proc/$kt_mountinfo_pid/mountinfo' /app/entrypoint.sh
grep -q 'kt_is_mountinfo_target' /app/entrypoint.sh
grep -q 'kt_mountinfo_guard_loop' /app/entrypoint.sh
grep -q 'overlay|/vol1/docker|docker-init|/docker/containers|napcat-instances|btrfs|/dev/mapper/trim' /app/entrypoint.sh
grep -q '/sys/class/dmi/id/product_name' /app/entrypoint.sh
grep -q '/sys/class/dmi/id/bios_vendor' /app/entrypoint.sh
grep -q '/sys/class/dmi/id/bios_version' /app/entrypoint.sh
grep -q '/etc/hosts' /app/entrypoint.sh
grep -q 'KT preserve mounted NapCat config' /app/entrypoint.sh
grep -q 'find NapCat.Shell -mindepth 1 -maxdepth 1 ! -name config' /app/entrypoint.sh
! grep -q 'cp -rf NapCat.Shell/\* napcat/' /app/entrypoint.sh

MOUNTINFO_HOST_LEAK_PATTERN='overlay|/vol1/docker|docker-init|/docker/containers|napcat-instances|btrfs|/dev/mapper/trim'
MOUNTINFO_GUARD_TIMEOUT_SECONDS="${MOUNTINFO_GUARD_TIMEOUT_SECONDS:-12}"

mountinfo_has_host_leak() {
  kt_mountinfo="$1"
  if [ -r "$kt_mountinfo" ] && grep -E "$MOUNTINFO_HOST_LEAK_PATTERN" "$kt_mountinfo" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

assert_no_mountinfo_host_leak() {
  kt_mountinfo="$1"
  if mountinfo_has_host_leak "$kt_mountinfo"; then
    echo "NapCat desktop-cn verify failed: mountinfo-host-leak:$kt_mountinfo" >&2
    exit 78
  fi
}

wait_for_mountinfo_guard_converged() {
  kt_mountinfo_pid="$1"
  kt_mountinfo_guard_deadline="$MOUNTINFO_GUARD_TIMEOUT_SECONDS"
  kt_mountinfo_guard_elapsed=0
  while [ "$kt_mountinfo_guard_elapsed" -le "$kt_mountinfo_guard_deadline" ]; do
    if [ ! -d "/proc/$kt_mountinfo_pid" ]; then
      return 0
    fi
    if ! mountinfo_has_host_leak "/proc/$kt_mountinfo_pid/mountinfo"; then
      return 0
    fi
    sleep 1
    kt_mountinfo_guard_elapsed=$((kt_mountinfo_guard_elapsed + 1))
  done
  return 1
}

assert_target_mountinfo_guard_converged() {
  kt_mountinfo_pid="$1"
  if wait_for_mountinfo_guard_converged "$kt_mountinfo_pid"; then
    return 0
  fi
  kt_mountinfo_comm="$(cat "/proc/$kt_mountinfo_pid/comm" 2>/dev/null || true)"
  kt_mountinfo_cmdline="$(tr '\000' ' ' < "/proc/$kt_mountinfo_pid/cmdline" 2>/dev/null || true)"
  echo "NapCat desktop-cn verify failed: mountinfo-host-leak:/proc/$kt_mountinfo_pid/mountinfo comm=$kt_mountinfo_comm cmdline=$kt_mountinfo_cmdline" >&2
  grep -E "$MOUNTINFO_HOST_LEAK_PATTERN" "/proc/$kt_mountinfo_pid/mountinfo" 2>/dev/null | head -n 1 >&2 || true
  exit 78
}

kt_is_mountinfo_target() {
  kt_target_comm="$1"
  kt_target_cmdline="$2"
  kt_target_argv0="${kt_target_cmdline%% *}"
  kt_target_rest="${kt_target_cmdline#* }"
  if [ "$kt_target_rest" = "$kt_target_cmdline" ]; then
    kt_target_rest=""
  fi
  kt_target_argv1="${kt_target_rest%% *}"
  kt_target_argv0_base="${kt_target_argv0##*/}"

  case "$kt_target_comm" in
    qq|QQ|NapCat|napcat|Xvfb)
      return 0
      ;;
  esac
  case "$kt_target_argv0_base" in
    qq|QQ|NapCat|napcat|Xvfb)
      return 0
      ;;
  esac
  case "$kt_target_argv0" in
    /opt/QQ/*|/app/napcat/*|/app/NapCat*)
      return 0
      ;;
  esac
  case "$kt_target_argv1" in
    /app/napcat/*|/app/NapCat*|*/NapCat.Shell*|*/napcat.mjs*)
      return 0
      ;;
  esac
  return 1
}

assert_no_mountinfo_host_leak /proc/1/mountinfo
for kt_mountinfo_pid_dir in /proc/[0-9]*; do
  [ -d "$kt_mountinfo_pid_dir" ] || continue
  kt_mountinfo_pid="${kt_mountinfo_pid_dir#/proc/}"
  kt_mountinfo_comm="$(cat "$kt_mountinfo_pid_dir/comm" 2>/dev/null || true)"
  kt_mountinfo_cmdline="$(tr '\000' ' ' < "$kt_mountinfo_pid_dir/cmdline" 2>/dev/null || true)"
  if kt_is_mountinfo_target "$kt_mountinfo_comm" "$kt_mountinfo_cmdline"; then
    assert_target_mountinfo_guard_converged "$kt_mountinfo_pid"
  fi
done
