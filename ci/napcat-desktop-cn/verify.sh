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
grep -q '/sys/class/dmi/id/product_name' /app/entrypoint.sh
grep -q '/sys/class/dmi/id/bios_vendor' /app/entrypoint.sh
grep -q '/sys/class/dmi/id/bios_version' /app/entrypoint.sh
grep -q '/etc/hosts' /app/entrypoint.sh
