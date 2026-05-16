#!/usr/bin/env bash
set -Eeuo pipefail

KT_K8S_ROOT="${KT_K8S_ROOT:-/vol1/docker/kt-k8s}"
CLUSTER_NAME="${CLUSTER_NAME:-kt-nas}"
K8S_NAMESPACE="${K8S_NAMESPACE:-kt-prod}"
REGISTRY_NAME="${REGISTRY_NAME:-kt-registry.localhost}"
REGISTRY_PORT="${REGISTRY_PORT:-5000}"
API_HOST_PORT="${API_HOST_PORT:-48085}"
API_NODE_PORT="${API_NODE_PORT:-30085}"
AGENT_CONTAINER="${AGENT_CONTAINER:-kt-node-agent}"
AGENT_KUBECONFIG="${AGENT_KUBECONFIG:-/home/jenkins/agent/kubeconfig/${CLUSTER_NAME}.jenkins.yaml}"
API_ENV_FILE_ON_AGENT="${API_ENV_FILE_ON_AGENT:-/home/jenkins/agent/env/kt-template-online-api/.env.production}"
API_ENV_SECRET="${API_ENV_SECRET:-kt-template-online-api-env}"
PAUSE_IMAGE="${PAUSE_IMAGE:-rancher/mirrored-pause:3.6}"
OLD_API_CONTAINER="${OLD_API_CONTAINER:-kt-template-online-api}"
STOP_OLD_API_CONTAINER="${STOP_OLD_API_CONTAINER:-false}"

REGISTRY_CONTAINER="k3d-${REGISTRY_NAME}"
K3D_NETWORK="k3d-${CLUSTER_NAME}"
HOST_KUBECONFIG="${KT_K8S_ROOT}/kubeconfig/${CLUSTER_NAME}.host.yaml"
JENKINS_KUBECONFIG="${KT_K8S_ROOT}/kubeconfig/${CLUSTER_NAME}.jenkins.yaml"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

warn() {
  printf '\n[%s] WARN: %s\n' "$(date '+%F %T')" "$*" >&2
}

die() {
  printf '\n[%s] ERROR: %s\n' "$(date '+%F %T')" "$*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Please run as root."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

cluster_exists() {
  docker inspect "k3d-${CLUSTER_NAME}-serverlb" "k3d-${CLUSTER_NAME}-server-0" >/dev/null 2>&1
}

install_k3d() {
  if command -v k3d >/dev/null 2>&1; then
    log "k3d already installed: $(k3d version | head -n 1)"
    return
  fi

  require_command curl
  log "Installing k3d from official installer"
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
  k3d version
}

kubectl_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    armv7l|armhf) echo arm ;;
    *) die "Unsupported kubectl architecture: $(uname -m)" ;;
  esac
}

install_kubectl() {
  if command -v kubectl >/dev/null 2>&1; then
    log "kubectl already installed: $(kubectl version --client=true --short 2>/dev/null || kubectl version --client=true)"
    return
  fi

  require_command curl
  local version arch
  version="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
  arch="$(kubectl_arch)"
  log "Installing kubectl ${version} for linux/${arch}"
  curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${version}/bin/linux/${arch}/kubectl"
  chmod +x /usr/local/bin/kubectl
  kubectl version --client=true
}

prepare_dirs() {
  log "Preparing ${KT_K8S_ROOT}"
  mkdir -p \
    "${KT_K8S_ROOT}/registry" \
    "${KT_K8S_ROOT}/kubeconfig" \
    "${KT_K8S_ROOT}/secrets" \
    "${KT_K8S_ROOT}/manifests" \
    "${KT_K8S_ROOT}/backups"
}

ensure_registry_host_entry() {
  if ! grep -Eq "[[:space:]]${REGISTRY_CONTAINER}([[:space:]]|$)" /etc/hosts; then
    log "Adding ${REGISTRY_CONTAINER} to /etc/hosts"
    printf '127.0.0.1 %s\n' "$REGISTRY_CONTAINER" >> /etc/hosts
  fi
}

ensure_registry() {
  if docker inspect "$REGISTRY_CONTAINER" >/dev/null 2>&1; then
    log "k3d registry already exists: ${REGISTRY_CONTAINER}"
    return
  fi

  log "Creating local k3d registry: ${REGISTRY_CONTAINER}:${REGISTRY_PORT}"
  k3d registry create "$REGISTRY_NAME" \
    --port "$REGISTRY_PORT" \
    -v "${KT_K8S_ROOT}/registry:/var/lib/registry"
}

assert_api_port_available_for_new_cluster() {
  cluster_exists && return

  local docker_owner
  docker_owner="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "(:|0\.0\.0\.0:|:::|127\.0\.0\.1:)${API_HOST_PORT}->" || true)"
  if [ -z "$docker_owner" ] && command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${API_HOST_PORT} )" | grep -q ":${API_HOST_PORT}" && docker_owner="non-docker-process"
  fi
  [ -z "$docker_owner" ] && return

  if [ "$STOP_OLD_API_CONTAINER" = "true" ]; then
    log "Host port ${API_HOST_PORT} is in use. Stopping old API container: ${OLD_API_CONTAINER}"
    docker rm -f "$OLD_API_CONTAINER" >/dev/null 2>&1 || true
    return
  fi

  die "Host port ${API_HOST_PORT} is in use: ${docker_owner}. Re-run with STOP_OLD_API_CONTAINER=true when you are ready to cut over."
}

ensure_cluster() {
  if cluster_exists; then
    log "k3d cluster already exists: ${CLUSTER_NAME}"
  else
    assert_api_port_available_for_new_cluster
    log "Creating k3d cluster: ${CLUSTER_NAME}"
    k3d cluster create "$CLUSTER_NAME" \
      --servers 1 \
      --agents 1 \
      --registry-use "${REGISTRY_CONTAINER}:${REGISTRY_PORT}" \
      -p "${API_HOST_PORT}:${API_NODE_PORT}@loadbalancer" \
      --kubeconfig-update-default=false \
      --kubeconfig-switch-context=false
  fi

  docker network connect "$K3D_NETWORK" "$REGISTRY_CONTAINER" >/dev/null 2>&1 || true
}

ensure_pause_image() {
  log "Ensuring K3s sandbox image in cluster: ${PAUSE_IMAGE}"
  if ! docker image inspect "$PAUSE_IMAGE" >/dev/null 2>&1; then
    docker pull "$PAUSE_IMAGE"
  fi
  k3d image import "$PAUSE_IMAGE" -c "$CLUSTER_NAME"
}

export_kubeconfigs() {
  log "Exporting kubeconfigs"
  k3d kubeconfig get "$CLUSTER_NAME" > "$HOST_KUBECONFIG"
  cp "$HOST_KUBECONFIG" "$JENKINS_KUBECONFIG"

  # Jenkins Agent runs inside Docker, so it reaches the API server through the k3d Docker network.
  kubectl config set-cluster "k3d-${CLUSTER_NAME}" \
    --server="https://k3d-${CLUSTER_NAME}-serverlb:6443" \
    --kubeconfig "$JENKINS_KUBECONFIG" >/dev/null

  chmod 600 "$HOST_KUBECONFIG" "$JENKINS_KUBECONFIG"
  kubectl --kubeconfig "$HOST_KUBECONFIG" get nodes
}

ensure_namespace() {
  log "Ensuring namespace: ${K8S_NAMESPACE}"
  kubectl --kubeconfig "$HOST_KUBECONFIG" create namespace "$K8S_NAMESPACE" \
    --dry-run=client -o yaml | kubectl --kubeconfig "$HOST_KUBECONFIG" apply -f -
}

sync_agent_kubeconfig() {
  if ! docker inspect "$AGENT_CONTAINER" >/dev/null 2>&1; then
    warn "Jenkins Agent container not found: ${AGENT_CONTAINER}. Copy ${JENKINS_KUBECONFIG} into ${AGENT_KUBECONFIG} after Agent is created."
    return
  fi

  if [ "$(docker inspect -f '{{.State.Running}}' "$AGENT_CONTAINER")" != "true" ]; then
    warn "Jenkins Agent container exists but is not running: ${AGENT_CONTAINER}. Start it before syncing kubeconfig."
    return
  fi

  log "Connecting Jenkins Agent to ${K3D_NETWORK}"
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$AGENT_CONTAINER" | grep -q "\"${K3D_NETWORK}\""; then
    docker network connect "$K3D_NETWORK" "$AGENT_CONTAINER"
  fi

  log "Copying kubeconfig into Jenkins Agent: ${AGENT_KUBECONFIG}"
  docker exec "$AGENT_CONTAINER" sh -lc "mkdir -p '$(dirname "$AGENT_KUBECONFIG")'"
  docker cp "$JENKINS_KUBECONFIG" "${AGENT_CONTAINER}:${AGENT_KUBECONFIG}"
  docker exec "$AGENT_CONTAINER" sh -lc "chmod 600 '${AGENT_KUBECONFIG}' && kubectl --kubeconfig '${AGENT_KUBECONFIG}' get namespace '${K8S_NAMESPACE}'"
}

sync_api_secret_if_present() {
  if ! docker inspect "$AGENT_CONTAINER" >/dev/null 2>&1; then
    return
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$AGENT_CONTAINER")" != "true" ]; then
    return
  fi
  if ! docker exec "$AGENT_CONTAINER" sh -lc "test -f '${API_ENV_FILE_ON_AGENT}'"; then
    warn "API env file not found in Agent: ${API_ENV_FILE_ON_AGENT}. Jenkins will fail K8s deploy until this file exists."
    return
  fi

  log "Creating/updating API env Secret from Agent env file"
  docker exec "$AGENT_CONTAINER" sh -lc "kubectl --kubeconfig '${AGENT_KUBECONFIG}' -n '${K8S_NAMESPACE}' create secret generic '${API_ENV_SECRET}' --from-env-file='${API_ENV_FILE_ON_AGENT}' --dry-run=client -o yaml | kubectl --kubeconfig '${AGENT_KUBECONFIG}' apply -f -"
}

main() {
  require_root
  require_command docker
  docker info >/dev/null

  install_k3d
  install_kubectl
  prepare_dirs
  ensure_registry_host_entry
  ensure_registry
  ensure_cluster
  ensure_pause_image
  export_kubeconfigs
  ensure_namespace
  sync_agent_kubeconfig
  sync_api_secret_if_present

  log "Bootstrap completed"
  cat <<EOF

Cluster:        ${CLUSTER_NAME}
Namespace:      ${K8S_NAMESPACE}
Registry:       ${REGISTRY_CONTAINER}:${REGISTRY_PORT}
Host kubeconfig:${HOST_KUBECONFIG}
Agent kubeconf: ${AGENT_KUBECONFIG}
API route:      NAS ${API_HOST_PORT} -> k3d NodePort ${API_NODE_PORT}

Jenkins defaults:
  DEPLOY_TARGET=k8s
  DOCKER_REGISTRY=${REGISTRY_CONTAINER}:${REGISTRY_PORT}
  KUBE_CONFIG_FILE=${AGENT_KUBECONFIG}
  CONTAINER_ENV_FILE=${API_ENV_FILE_ON_AGENT}

EOF
}

main "$@"
