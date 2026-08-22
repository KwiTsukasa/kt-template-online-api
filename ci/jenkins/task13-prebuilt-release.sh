#!/bin/sh
set -eu

umask 077

: "${TASK13_API_IMAGE:?TASK13_API_IMAGE is required.}"
: "${TASK13_MIGRATION_API_IMAGE:?TASK13_MIGRATION_API_IMAGE is required.}"
: "${TASK13_FALLBACK_API_IMAGE:?TASK13_FALLBACK_API_IMAGE is required.}"
: "${TASK13_GATEWAY_IMAGE:?TASK13_GATEWAY_IMAGE is required.}"
: "${TASK13_EXPECTED_SOURCE_COMMIT:?TASK13_EXPECTED_SOURCE_COMMIT is required.}"
: "${TASK13_MIGRATION_BATCH_ID:?TASK13_MIGRATION_BATCH_ID is required.}"
: "${TASK13_CHANGE_CAUSE:?TASK13_CHANGE_CAUSE is required.}"

KUBECONFIG='/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml'
CONTAINER_ENV_FILE='/home/jenkins/agent/env/kt-template-online-api/.env.production'
K8S_MANIFEST_FILE='k8s/prod/api.yaml'
K8S_NAMESPACE='kt-prod'
K8S_DEPLOYMENT='kt-template-online-api'
K8S_ENV_SECRET='kt-template-online-api-env'
K8S_ROLLOUT_TIMEOUT='180s'
GATEWAY_DEPLOYMENT='kt-napcat-webui-gateway'
API_REPOSITORY='k3d-kt-registry.localhost:5000/kt-template-online-api'
GATEWAY_REPOSITORY='k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway'
REPLICAS_JSONPATH='{.spec.replicas}'
API_IMAGE_JSONPATH='{.spec.template.spec.containers[?(@.name=="api")].image}'
GATEWAY_IMAGE_JSONPATH='{.spec.template.spec.containers[?(@.name=="gateway")].image}'
MAINTENANCE_STATE_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-maintenance}'
MAINTENANCE_BATCH_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-maintenance-batch}'
MAINTENANCE_IMAGE_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-migration-image}'
FALLBACK_IMAGE_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-fallback-image}'
ENVIRONMENT_SHA_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-env-sha256}'
OFF_NAS_BACKUP_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-off-nas-backup-sha256}'
BLOG_VERIFIED_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-blog-verified}'
ADMIN_VERIFIED_JSONPATH='{.metadata.annotations.kt\.kwitsukasa\.top/task13-admin-verified}'
TASK13_ATTESTATION_PREFIX="$TASK13_MIGRATION_BATCH_ID:"

kubectl_cmd() {
  kubectl --kubeconfig "$KUBECONFIG" -n "$K8S_NAMESPACE" "$@"
}

deployment_value() {
  kubectl_cmd get "deployment/$K8S_DEPLOYMENT" -o "jsonpath=$1"
}

require_exact_image() {
  image=$1
  repository=$2
  error_message=$3
  digest=${image#"$repository@"}
  if [ "$digest" = "$image" ] ||
    ! printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
    echo "$error_message"
    exit 1
  fi
}

require_runtime_env() {
  missing=0
  for key in \
    DB_HOST \
    DB_PORT \
    DB_USERNAME \
    DB_PASSWORD \
    DB_DATABASE \
    ADMIN_TOKEN_SECRET \
    FFLOGS_CLIENT_ID \
    FFLOGS_CLIENT_SECRET \
    PLUGIN_QUEUE_REDIS_HOST \
    PLUGIN_QUEUE_REDIS_PORT \
    NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET \
    NETWORK_AGENT_ID \
    NETWORK_AGENT_TARGET_IPV4 \
    NETWORK_AGENT_MQTT_URL \
    NETWORK_AGENT_MQTT_CLIENT_ID \
    NETWORK_AGENT_MQTT_USERNAME \
    NETWORK_AGENT_MQTT_PASSWORD \
    NETWORK_AGENT_MQTT_RETRY_MS \
    PUBLIC_SECURITY_TRUSTED_PROXY_IPS \
    PUBLIC_SECURITY_SWAGGER_ALLOWLIST
  do
    if ! grep -Eq "^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]]+" \
      "$CONTAINER_ENV_FILE"; then
      echo "Missing required runtime env key: $key"
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    echo "Update the private .env.production used by Jenkins before deploying."
    exit 1
  fi
}

require_task13_attestation() {
  attestation_value=$1
  attestation_error=$2
  case "$attestation_value" in
    "$TASK13_ATTESTATION_PREFIX"*) ;;
    *)
      echo "$attestation_error"
      exit 1
      ;;
  esac
  attestation_sha256=${attestation_value#"$TASK13_ATTESTATION_PREFIX"}
  if ! printf '%s' "$attestation_sha256" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "$attestation_error"
    exit 1
  fi
}

restore_prebuilt_api_zero() {
  if [ "${prebuilt_release_complete:-false}" = "true" ]; then
    return
  fi
  set +e
  restore_failed=0
  kubectl_cmd scale "deployment/$K8S_DEPLOYMENT" --replicas=0 >/dev/null 2>&1 ||
    restore_failed=1
  if [ -n "$(kubectl_cmd get pods -l "app=$K8S_DEPLOYMENT" -o name 2>/dev/null)" ]; then
    kubectl_cmd wait --for=delete pod -l "app=$K8S_DEPLOYMENT" \
      --timeout="$K8S_ROLLOUT_TIMEOUT" >/dev/null 2>&1 ||
      restore_failed=1
  fi
  if [ "$(deployment_value "$REPLICAS_JSONPATH" 2>/dev/null)" != "0" ]; then
    restore_failed=1
  fi
  if [ -n "$(kubectl_cmd get pods -l "app=$K8S_DEPLOYMENT" -o name 2>/dev/null)" ]; then
    restore_failed=1
  fi
  if [ "$restore_failed" -ne 0 ]; then
    echo "Prebuilt release recovery could not restore API to zero." >&2
  fi
  return "$restore_failed"
}

cleanup_release_artifacts() {
  if [ -n "${OVERLAY_DIR:-}" ]; then
    rm -rf -- "$OVERLAY_DIR"
  fi
}

if ! printf '%s' "$TASK13_EXPECTED_SOURCE_COMMIT" |
  grep -Eq '^[0-9a-f]{40}$'; then
  echo "Task 13 expected source commit is invalid."
  exit 1
fi
if ! printf '%s' "$TASK13_MIGRATION_BATCH_ID" |
  grep -Eq '^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'; then
  echo "Task 13 migration batch is invalid."
  exit 1
fi
if ! printf '%s' "$TASK13_CHANGE_CAUSE" |
  grep -Eq '^Jenkins [A-Za-z0-9._/-]+ #[1-9][0-9]* [0-9a-f]{40}$'; then
  echo "Task 13 change cause is invalid."
  exit 1
fi
require_exact_image \
  "$TASK13_API_IMAGE" \
  "$API_REPOSITORY" \
  "Task 13 target API image is invalid."
require_exact_image \
  "$TASK13_MIGRATION_API_IMAGE" \
  "$API_REPOSITORY" \
  "Task 13 migration API image is invalid."
require_exact_image \
  "$TASK13_FALLBACK_API_IMAGE" \
  "$API_REPOSITORY" \
  "Task 13 fallback API image is invalid."
require_exact_image \
  "$TASK13_GATEWAY_IMAGE" \
  "$GATEWAY_REPOSITORY" \
  "Task 13 Gateway image is invalid."
if [ "$TASK13_API_IMAGE" != "$TASK13_MIGRATION_API_IMAGE" ] &&
  [ "$TASK13_API_IMAGE" != "$TASK13_FALLBACK_API_IMAGE" ]; then
  echo "Task 13 target API image is outside the approved migration/fallback pair."
  exit 1
fi
if [ "${TASK13_MIGRATION_API_IMAGE##*@}" = "${TASK13_FALLBACK_API_IMAGE##*@}" ]; then
  echo "Task 13 migration and fallback digests must be distinct."
  exit 1
fi

for required_file in "$KUBECONFIG" "$CONTAINER_ENV_FILE" "$K8S_MANIFEST_FILE"; do
  if [ ! -f "$required_file" ]; then
    echo "Required Task 13 release file not found: $required_file"
    exit 1
  fi
done
if [ -L "$CONTAINER_ENV_FILE" ]; then
  echo "Task 13 production env must be a regular non-symbolic file."
  exit 1
fi
if [ "$(stat -c '%a' "$CONTAINER_ENV_FILE")" != "600" ]; then
  echo "Task 13 production env must use mode 0600."
  exit 1
fi
if [ "$(stat -c '%u' "$CONTAINER_ENV_FILE")" != "$(id -u)" ]; then
  echo "Task 13 production env must be owned by the Jenkins Agent user."
  exit 1
fi
require_runtime_env

kubectl --kubeconfig "$KUBECONFIG" get namespace "$K8S_NAMESPACE" >/dev/null
if [ "$(deployment_value "$REPLICAS_JSONPATH")" != "0" ]; then
  echo "Task 13 maintenance requires zero desired API replicas."
  exit 1
fi
if [ -n "$(kubectl_cmd get pods -l "app=$K8S_DEPLOYMENT" -o name)" ]; then
  echo "Task 13 maintenance requires zero API Pods."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_STATE_JSONPATH")" != "active" ]; then
  echo "Task 13 maintenance lease is not active."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_BATCH_JSONPATH")" != "$TASK13_MIGRATION_BATCH_ID" ]; then
  echo "Task 13 maintenance batch does not match the release."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_IMAGE_JSONPATH")" != "$TASK13_MIGRATION_API_IMAGE" ]; then
  echo "Task 13 maintenance image does not match the migration digest."
  exit 1
fi
if [ "$(deployment_value "$FALLBACK_IMAGE_JSONPATH")" != "$TASK13_FALLBACK_API_IMAGE" ]; then
  echo "Task 13 fallback image does not match the approved digest."
  exit 1
fi
ENV_SHA256="$(sha256sum -- "$CONTAINER_ENV_FILE" | awk '{print $1}')"
if [ "$(deployment_value "$ENVIRONMENT_SHA_JSONPATH")" != "$ENV_SHA256" ]; then
  echo "Task 13 production env fingerprint does not match migration."
  exit 1
fi
OFF_NAS_SHA256="$(deployment_value "$OFF_NAS_BACKUP_JSONPATH")"
BLOG_VERIFIED_SHA256="$(deployment_value "$BLOG_VERIFIED_JSONPATH")"
ADMIN_VERIFIED_SHA256="$(deployment_value "$ADMIN_VERIFIED_JSONPATH")"
require_task13_attestation \
  "$OFF_NAS_SHA256" \
  "Task 13 off-NAS backup attestation is missing."
require_task13_attestation \
  "$BLOG_VERIFIED_SHA256" \
  "Task 13 Blog verification attestation is missing."
require_task13_attestation \
  "$ADMIN_VERIFIED_SHA256" \
  "Task 13 Admin verification attestation is missing."

docker pull "$TASK13_MIGRATION_API_IMAGE"
docker pull "$TASK13_FALLBACK_API_IMAGE"
docker pull "$TASK13_GATEWAY_IMAGE"
MIGRATION_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$TASK13_MIGRATION_API_IMAGE")"
FALLBACK_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$TASK13_FALLBACK_API_IMAGE")"
if [ -z "$MIGRATION_IMAGE_ID" ] ||
  [ -z "$FALLBACK_IMAGE_ID" ] ||
  [ "$MIGRATION_IMAGE_ID" = "$FALLBACK_IMAGE_ID" ]; then
  echo "Migration and fallback images resolve to the same Docker image ID."
  exit 1
fi
MIGRATION_REVISION="$(
  docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$TASK13_MIGRATION_API_IMAGE"
)"
GATEWAY_REVISION="$(
  docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$TASK13_GATEWAY_IMAGE"
)"
MIGRATION_BUILD_PAIR="$(
  docker image inspect \
    --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' \
    "$TASK13_MIGRATION_API_IMAGE"
)"
GATEWAY_BUILD_PAIR="$(
  docker image inspect \
    --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' \
    "$TASK13_GATEWAY_IMAGE"
)"
if [ "$MIGRATION_REVISION" != "$TASK13_EXPECTED_SOURCE_COMMIT" ] ||
  [ "$GATEWAY_REVISION" != "$TASK13_EXPECTED_SOURCE_COMMIT" ]; then
  echo "Target image revision does not match EXPECTED_SOURCE_COMMIT."
  exit 1
fi
if [ -z "$MIGRATION_BUILD_PAIR" ] ||
  [ "$MIGRATION_BUILD_PAIR" != "$GATEWAY_BUILD_PAIR" ]; then
  echo "API and Gateway images are not from the same build."
  exit 1
fi

# 以上全部是只读门禁；先在未导出的变量中完整生成，Secret apply 才是第一次生产写入。
SECRET_MANIFEST="$(
  kubectl_cmd create secret generic "$K8S_ENV_SECRET" \
    --from-env-file="$CONTAINER_ENV_FILE" \
    --dry-run=client -o yaml
)"
OVERLAY_DIR=''
trap cleanup_release_artifacts EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$SECRET_MANIFEST" |
  kubectl --kubeconfig "$KUBECONFIG" apply -f -
unset SECRET_MANIFEST

API_IMAGE_REPOSITORY=${TASK13_API_IMAGE%@*}
API_IMAGE_DIGEST=${TASK13_API_IMAGE##*@}
GATEWAY_IMAGE_REPOSITORY=${TASK13_GATEWAY_IMAGE%@*}
GATEWAY_IMAGE_DIGEST=${TASK13_GATEWAY_IMAGE##*@}
OVERLAY_DIR="$(mktemp -d .jenkins-kustomize.XXXXXX)"
RENDERED_MANIFEST="$OVERLAY_DIR/rendered.yaml"

cp -- "$K8S_MANIFEST_FILE" "$OVERLAY_DIR/api.yaml"
cat >"$OVERLAY_DIR/kustomization.yaml" <<KUSTOMIZATION
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - api.yaml
images:
  - name: $API_REPOSITORY
    newName: $API_IMAGE_REPOSITORY
    digest: $API_IMAGE_DIGEST
  - name: $GATEWAY_REPOSITORY
    newName: $GATEWAY_IMAGE_REPOSITORY
    digest: $GATEWAY_IMAGE_DIGEST
patches:
  - target:
      group: apps
      version: v1
      kind: Deployment
      name: $K8S_DEPLOYMENT
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 0
KUSTOMIZATION

kubectl kustomize "$OVERLAY_DIR" >"$RENDERED_MANIFEST"
awk \
  -v api_deployment="$K8S_DEPLOYMENT" \
  -v gateway_deployment="$GATEWAY_DEPLOYMENT" \
  -v api_image="$TASK13_API_IMAGE" \
  -v gateway_image="$TASK13_GATEWAY_IMAGE" '
  function reset_document() {
    kind = ""
    name = ""
    replicas = ""
    api_images = 0
    gateway_images = 0
  }
  function finish_document() {
    if (kind != "Deployment") return
    if (name == api_deployment) {
      api_documents += 1
      if (replicas != "0" || api_images != 1 || gateway_images != 0) failed = 1
    }
    if (name == gateway_deployment) {
      gateway_documents += 1
      if (gateway_images != 1 || api_images != 0) failed = 1
    }
  }
  BEGIN { reset_document() }
  $0 == "---" {
    finish_document()
    reset_document()
    next
  }
  $1 == "kind:" { kind = $2 }
  $1 == "name:" && $0 ~ /^  name:/ { name = $2 }
  $1 == "replicas:" && $0 ~ /^  replicas:/ { replicas = $2 }
  index($0, "image: " api_image) > 0 { api_images += 1 }
  index($0, "image: " gateway_image) > 0 { gateway_images += 1 }
  END {
    finish_document()
    if (failed || api_documents != 1 || gateway_documents != 1) {
      print "Rendered prebuilt manifest failed the exact image or zero-replica contract." > "/dev/stderr"
      exit 1
    }
  }
' "$RENDERED_MANIFEST"
kubectl_cmd apply --dry-run=client --validate=false -f "$RENDERED_MANIFEST" >/dev/null

finish_prebuilt_release() {
  release_exit_code=$?
  restore_prebuilt_api_zero || release_exit_code=1
  cleanup_release_artifacts
  trap - EXIT HUP INT TERM
  exit "$release_exit_code"
}

prebuilt_release_complete=false
trap finish_prebuilt_release EXIT
trap 'exit 1' HUP INT TERM
kubectl_cmd apply -f "$RENDERED_MANIFEST"
if [ "$(deployment_value "$REPLICAS_JSONPATH")" != "0" ]; then
  echo "Prebuilt API deployment was not applied at zero replicas."
  exit 1
fi
if [ "$(deployment_value "$API_IMAGE_JSONPATH")" != "$TASK13_API_IMAGE" ]; then
  echo "Prebuilt API deployment image does not match the requested digest."
  exit 1
fi
if [ "$(
  kubectl_cmd get "deployment/$GATEWAY_DEPLOYMENT" \
    -o "jsonpath=$GATEWAY_IMAGE_JSONPATH"
)" != "$TASK13_GATEWAY_IMAGE" ]; then
  echo "Prebuilt Gateway deployment image does not match the requested digest."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_STATE_JSONPATH")" != "active" ]; then
  echo "Task 13 maintenance lease is not active."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_BATCH_JSONPATH")" != "$TASK13_MIGRATION_BATCH_ID" ]; then
  echo "Task 13 maintenance batch does not match the release."
  exit 1
fi
if [ "$(deployment_value "$MAINTENANCE_IMAGE_JSONPATH")" != "$TASK13_MIGRATION_API_IMAGE" ]; then
  echo "Task 13 maintenance image does not match the migration digest."
  exit 1
fi
if [ "$(deployment_value "$FALLBACK_IMAGE_JSONPATH")" != "$TASK13_FALLBACK_API_IMAGE" ]; then
  echo "Task 13 fallback image does not match the approved digest."
  exit 1
fi
if [ "$(deployment_value "$ENVIRONMENT_SHA_JSONPATH")" != "$ENV_SHA256" ]; then
  echo "Task 13 production env fingerprint does not match migration."
  exit 1
fi
for attestation_jsonpath in \
  "$OFF_NAS_BACKUP_JSONPATH" \
  "$BLOG_VERIFIED_JSONPATH" \
  "$ADMIN_VERIFIED_JSONPATH"
do
  attestation_value="$(deployment_value "$attestation_jsonpath")"
  require_task13_attestation \
    "$attestation_value" \
    "Task 13 migration completion attestation drifted."
done
if [ -n "$(kubectl_cmd get pods -l "app=$K8S_DEPLOYMENT" -o name)" ]; then
  echo "Task 13 API Pods reappeared before release."
  exit 1
fi

kubectl_cmd annotate "deployment/$K8S_DEPLOYMENT" \
  "kubernetes.io/change-cause=$TASK13_CHANGE_CAUSE" --overwrite
kubectl_cmd annotate "deployment/$GATEWAY_DEPLOYMENT" \
  "kubernetes.io/change-cause=$TASK13_CHANGE_CAUSE" --overwrite
kubectl_cmd scale "deployment/$K8S_DEPLOYMENT" --replicas=1
kubectl_cmd rollout status "deployment/$K8S_DEPLOYMENT" \
  --timeout="$K8S_ROLLOUT_TIMEOUT"
kubectl_cmd rollout status "deployment/$GATEWAY_DEPLOYMENT" \
  --timeout="$K8S_ROLLOUT_TIMEOUT"
kubectl_cmd get pod,svc -l "app in ($K8S_DEPLOYMENT,$GATEWAY_DEPLOYMENT)"
prebuilt_release_complete=true
