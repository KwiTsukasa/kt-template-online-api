#!/bin/sh
set -eu

locale -a | grep -i '^zh_CN.utf8$'
locale | grep 'LANG=zh_CN.UTF-8'
test "$(cat /etc/timezone)" = "Asia/Shanghai"
fc-match "Noto Sans CJK SC" | grep -E 'Noto|WenQuanYi|wqy'
test "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-}" = "XDG_CONFIG_HOME=/app/.config"
test "XDG_CACHE_HOME=${XDG_CACHE_HOME:-}" = "XDG_CACHE_HOME=/app/.cache"
test "XDG_DATA_HOME=${XDG_DATA_HOME:-}" = "XDG_DATA_HOME=/app/.local/share"
test ! -e /.dockerenv
grep -q '^0::/$' /proc/1/cgroup
unzip -p /app/NapCat.Shell.zip napcat.mjs | grep -q 'selfInfo?.online !== false'
unzip -p /app/NapCat.Shell.zip napcat.mjs | grep -q 'setQQLoginStatus(false)'
