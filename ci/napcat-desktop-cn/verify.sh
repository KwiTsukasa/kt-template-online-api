#!/bin/sh
set -eu

MARKER=/ci/napcat-desktop-cn/fork-artifact.json
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

locale -a | grep -i '^zh_CN.utf8$'
locale | grep 'LANG=zh_CN.UTF-8'
test "$(cat /etc/timezone)" = "Asia/Shanghai"
fc-match "Noto Sans CJK SC" | grep -E 'Noto|WenQuanYi|wqy'
test "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-}" = "XDG_CONFIG_HOME=/app/.config"
test "XDG_CACHE_HOME=${XDG_CACHE_HOME:-}" = "XDG_CACHE_HOME=/app/.cache"
test "XDG_DATA_HOME=${XDG_DATA_HOME:-}" = "XDG_DATA_HOME=/app/.local/share"
test ! -e /.dockerenv
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
