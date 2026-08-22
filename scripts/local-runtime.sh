#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

mode=${1:-start}
env_file=${KT_LOCAL_ENV_FILE:-$PROJECT_ROOT/.env.development}
db_host=${KT_LOCAL_DB_HOST:-127.0.0.1}
db_port=${KT_LOCAL_DB_PORT:-3306}
db_database=${KT_LOCAL_DB_DATABASE:-kt_template_local}
redis_host=${KT_LOCAL_REDIS_HOST:-127.0.0.1}
redis_port=${KT_LOCAL_REDIS_PORT:-6379}
api_host=${KT_LOCAL_API_HOST:-127.0.0.1}
api_port=48085
start_timeout_seconds=${KT_LOCAL_START_TIMEOUT_SECONDS:-90}
artifact_root=${KT_LOCAL_ARTIFACT_ROOT:-$PROJECT_ROOT/.kt-workspace/test-artifacts/local-runtime}

api_pid=''
redis_pid=''
redis_started=false
redis_runtime=''
powershell_exe=''

# Prints local runtime usage without touching services or databases.
print_help() {
  cat <<'EOF'
Usage: local-runtime.sh [start|dev|verify]

Prepare a disposable local database, reuse Windows MySQL, ensure Redis, and:
  start   start the API once in the foreground
  dev     start the API watcher in the foreground
  verify  start the API, run real HTTP/SSE message-center smoke, then clean up

Optional overrides:
  KT_LOCAL_DB_HOST / KT_LOCAL_DB_PORT
  KT_LOCAL_DB_DATABASE       must match kt_template_local or kt_template_local_*
  KT_LOCAL_REDIS_HOST / KT_LOCAL_REDIS_PORT
  KT_LOCAL_API_HOST
  KT_LOCAL_ENV_FILE
  KT_LOCAL_ADMIN_PASSWORD  defaults to the disposable seed password
EOF
}

# Reports a bounded local runtime failure.
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

# Returns success when a value is a valid TCP port.
is_valid_port() {
  [[ $1 =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

# Returns success when a TCP endpoint accepts a connection within two seconds.
probe_tcp() {
  timeout --foreground --kill-after=1s 2s \
    bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" \
    >/dev/null 2>&1
}

# Resolves Windows PowerShell from PATH or the stable System32 location.
resolve_powershell() {
  powershell_exe=$(command -v powershell.exe || true)
  if [[ -z $powershell_exe ]] && \
    [[ -x /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe ]]; then
    powershell_exe=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
  fi
}

# Starts an installed Windows MySQL service when the configured endpoint is closed.
start_windows_mysql() {
  [[ -n $powershell_exe ]] || return 1
  "$powershell_exe" -NoLogo -NoProfile -NonInteractive -Command '
    $ErrorActionPreference = "Stop"
    $service = Get-Service | Where-Object {
      ($_.Name -match "(?i)^(mysql|maria)") -or
      ($_.DisplayName -match "(?i)^(mysql|maria)")
    } | Select-Object -First 1
    if (!$service) {
      throw "Windows MySQL service was not found"
    }
    if ($service.Status -ne "Running") {
      Start-Service -Name $service.Name
      $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(15))
    }
    Write-Output $service.Name
  ' >/dev/null
}

# Starts the installed Windows Redis binary with its colocated redis.conf.
start_windows_redis() {
  [[ -n $powershell_exe ]] || return 1
  local output
  output=$(
    "$powershell_exe" -NoLogo -NoProfile -NonInteractive -Command '
      $ErrorActionPreference = "Stop"
      $redis = Get-Command redis-server.exe -ErrorAction Stop
      $redisRoot = Split-Path -Parent $redis.Source
      $config = Join-Path $redisRoot "redis.conf"
      if (!(Test-Path -LiteralPath $config)) {
        throw "redis.conf was not found beside redis-server.exe"
      }
      $process = Start-Process `
        -FilePath $redis.Source `
        -ArgumentList @("redis.conf") `
        -WorkingDirectory $redisRoot `
        -WindowStyle Hidden `
        -PassThru
      Start-Sleep -Milliseconds 500
      if ($process.HasExited) {
        throw "redis-server.exe exited during startup"
      }
      Write-Output $process.Id
    '
  )
  redis_pid=$(printf '%s\n' "$output" | tr -d '\r' | tail -n 1)
  [[ $redis_pid =~ ^[1-9][0-9]*$ ]] || return 1
  redis_started=true
  redis_runtime=windows
}

# Starts a local Linux Redis process when one is installed outside WSL Windows integration.
start_linux_redis() {
  command -v redis-server >/dev/null 2>&1 || return 1
  redis-server \
    --bind "$redis_host" \
    --port "$redis_port" \
    --save '' \
    --appendonly no \
    --daemonize no \
    >"$artifact_root/redis.log" 2>&1 &
  redis_pid=$!
  redis_started=true
  redis_runtime=linux
}

# Waits for a TCP endpoint with a bounded retry window.
wait_for_endpoint() {
  local host=$1
  local port=$2
  local label=$3
  local attempt
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if probe_tcp "$host" "$port"; then
      return 0
    fi
    sleep 1
  done
  fail "$label 在 30 秒内未监听 $host:$port"
}

# Stops only the Redis process created by this invocation.
stop_started_redis() {
  [[ $redis_started == true ]] || return 0
  [[ $redis_pid =~ ^[1-9][0-9]*$ ]] || return 0
  if [[ $redis_runtime == windows ]]; then
    "$powershell_exe" -NoLogo -NoProfile -NonInteractive -Command '& {
        param([int] $processId)
        $ErrorActionPreference = "SilentlyContinue"
        Stop-Process -Id $processId -Force
      }' -processId "$redis_pid" >/dev/null 2>&1 || true
    return 0
  fi
  if kill -0 "$redis_pid" 2>/dev/null; then
    kill -TERM "$redis_pid" 2>/dev/null || true
    wait "$redis_pid" 2>/dev/null || true
  fi
}

# Cleans only the API and Redis processes started by this invocation.
cleanup() {
  if [[ -n $api_pid ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill -TERM -- "-$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  stop_started_redis
}

# Exports a deterministic local-only application profile without editing .env.development.
export_local_profile() {
  export NODE_ENV=development
  export DB_HOST=$db_host
  export DB_PORT=$db_port
  export DB_DATABASE=$db_database
  export DB_SYNC=false
  export ADMIN_AUTH_ALLOW_INSECURE_LOCAL=true
  export ADMIN_COOKIE_SECURE=false
  export PUBLIC_RATE_LIMIT_REDIS_HOST=$redis_host
  export PUBLIC_RATE_LIMIT_REDIS_PORT=$redis_port
  export PUBLIC_RATE_LIMIT_REDIS_KEY_PREFIX=kt:local:public-rate-limit
  export PLUGIN_QUEUE_REDIS_HOST=$redis_host
  export PLUGIN_QUEUE_REDIS_PORT=$redis_port
  export PLUGIN_TASK_QUEUE_REDIS_HOST=$redis_host
  export PLUGIN_TASK_QUEUE_REDIS_PORT=$redis_port
  export BOT_ENABLED=false
  export BOT_EVENT_BUS=local
  export MQTT_URL=
  export NAPCAT_WATCHDOG_ENABLED=false
  export NETWORK_AGENT_MQTT_URL=
  export NETWORK_DDNS_DNSPOD_ENABLED=false
  export NETWORK_TCP_NATMAP_RELEASE_MODE=off
  export ENV_DASHBOARD_EVENT_BUS=local
  export ENV_DASHBOARD_MQTT_URL=
  export KT_LOCAL_API_BASE_URL="http://$api_host:$api_port"
  export KT_LOCAL_ADMIN_PASSWORD=${KT_LOCAL_ADMIN_PASSWORD:-123456}
}

# Prepares Windows-backed dependencies and rebuilds the disposable schema baseline.
prepare_runtime() {
  [[ -f $env_file ]] || fail "缺少 $env_file；请先从 .env.example 创建一次本机私有配置"
  mkdir -p "$artifact_root"
  resolve_powershell

  if ! probe_tcp "$db_host" "$db_port"; then
    printf 'MySQL 未监听，尝试启动 Windows 服务...\n'
    start_windows_mysql || fail "无法启动 Windows MySQL；请确认服务权限与端口 $db_port"
    wait_for_endpoint "$db_host" "$db_port" MySQL
  fi

  if ! probe_tcp "$redis_host" "$redis_port"; then
    printf 'Redis 未监听，尝试启动本机已安装实例...\n'
    if [[ -n $powershell_exe ]] && [[ $redis_port == 6379 ]]; then
      start_windows_redis || fail 'Windows redis-server.exe 启动失败'
    else
      start_linux_redis || fail "未找到可启动的 Redis，目标为 $redis_host:$redis_port"
    fi
    wait_for_endpoint "$redis_host" "$redis_port" Redis
  fi

  export_local_profile
  node --env-file="$env_file" "$SCRIPT_DIR/local-runtime-database.mjs"
  printf '本地依赖就绪：mysql=%s:%s redis=%s:%s database=%s\n' \
    "$db_host" "$db_port" "$redis_host" "$redis_port" "$db_database"
}

# Waits for the API health endpoint while detecting an early process exit.
wait_for_api() {
  local deadline=$((SECONDS + start_timeout_seconds))
  while ((SECONDS < deadline)); do
    if curl --fail --silent --show-error \
      --connect-timeout 2 \
      --max-time 2 \
      "http://$api_host:$api_port/health/runtime" \
      >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$api_pid" 2>/dev/null; then
      tail -n 80 "$artifact_root/api.log" >&2 || true
      fail 'API 在健康检查前退出'
    fi
    sleep 1
  done
  tail -n 80 "$artifact_root/api.log" >&2 || true
  fail "API 在 ${start_timeout_seconds} 秒内未就绪"
}

case "$mode" in
  -h|--help|help)
    print_help
    exit 0
    ;;
  start|dev|verify)
    ;;
  *)
    print_help >&2
    fail "未知模式：$mode"
    ;;
esac

command -v timeout >/dev/null 2>&1 || fail 'GNU timeout 不可用'
command -v node >/dev/null 2>&1 || fail 'Node.js 不可用'
command -v pnpm >/dev/null 2>&1 || fail 'pnpm 不可用'
command -v curl >/dev/null 2>&1 || fail 'curl 不可用'
command -v setsid >/dev/null 2>&1 || fail 'setsid 不可用'
is_valid_port "$db_port" || fail 'KT_LOCAL_DB_PORT 不是有效端口'
is_valid_port "$redis_port" || fail 'KT_LOCAL_REDIS_PORT 不是有效端口'
[[ $start_timeout_seconds =~ ^[1-9][0-9]*$ ]] || \
  fail 'KT_LOCAL_START_TIMEOUT_SECONDS 必须是正整数'
[[ $db_database =~ ^kt_template_local(_[a-z0-9_]+)?$ ]] || \
  fail 'KT_LOCAL_DB_DATABASE 必须匹配 kt_template_local 或 kt_template_local_*'

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd -- "$PROJECT_ROOT"
prepare_runtime

if [[ $mode == verify ]]; then
  setsid pnpm exec nest start >"$artifact_root/api.log" 2>&1 &
  api_pid=$!
  wait_for_api
  node --env-file="$env_file" "$SCRIPT_DIR/local-runtime-smoke.mjs"
  printf '本地真实链路验证通过；日志：%s\n' "$artifact_root/api.log"
  exit 0
fi

nest_args=(start)
if [[ $mode == dev ]]; then
  nest_args+=(--watch)
fi
setsid pnpm exec nest "${nest_args[@]}" &
api_pid=$!
wait "$api_pid"
