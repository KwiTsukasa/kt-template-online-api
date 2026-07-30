#!/bin/sh
set -eu

umask 077

: "${TASK13_API_IMAGE:?TASK13_API_IMAGE is required.}"
: "${TASK13_GATEWAY_IMAGE:?TASK13_GATEWAY_IMAGE is required.}"
: "${TASK13_EXPECTED_SOURCE_COMMIT:?TASK13_EXPECTED_SOURCE_COMMIT is required.}"
: "${TASK13_EXPECTED_BUILD_PAIR:?TASK13_EXPECTED_BUILD_PAIR is required.}"

API_REPOSITORY='k3d-kt-registry.localhost:5000/kt-template-online-api'
GATEWAY_REPOSITORY='k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway'
EVIDENCE_DIR='.kt-workspace/task13-prebuild'
EVIDENCE_FILE="$EVIDENCE_DIR/task13-exact-digests.env"
EVIDENCE_TEMP="$EVIDENCE_FILE.tmp"

if ! printf '%s' "$TASK13_EXPECTED_SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Task 13 expected source commit is invalid."
  exit 1
fi
if ! printf '%s' "$TASK13_EXPECTED_BUILD_PAIR" |
  grep -Eq "^${TASK13_EXPECTED_SOURCE_COMMIT}:[1-9][0-9]*$"; then
  echo "Task 13 expected build pair is invalid."
  exit 1
fi
case "$TASK13_API_IMAGE" in
  "$API_REPOSITORY":*) ;;
  *)
    echo "Task 13 API build image is outside the canonical repository."
    exit 1
    ;;
esac
case "$TASK13_GATEWAY_IMAGE" in
  "$GATEWAY_REPOSITORY":*) ;;
  *)
    echo "Task 13 Gateway build image is outside the canonical repository."
    exit 1
    ;;
esac
API_TAG=${TASK13_API_IMAGE#"$API_REPOSITORY:"}
GATEWAY_TAG=${TASK13_GATEWAY_IMAGE#"$GATEWAY_REPOSITORY:"}
if ! printf '%s' "$API_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]*$' ||
  ! printf '%s' "$GATEWAY_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]*$'; then
  echo "Task 13 build image tag is invalid."
  exit 1
fi

cleanup_task13_prebuild_evidence() {
  rm -f -- "$EVIDENCE_TEMP"
}

trap cleanup_task13_prebuild_evidence EXIT
trap 'exit 1' HUP INT TERM

docker push "$TASK13_API_IMAGE"
docker push "$TASK13_GATEWAY_IMAGE"
API_EXACT_IMAGE="$(
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' \
    "$TASK13_API_IMAGE" |
    awk -v prefix="$API_REPOSITORY@" 'index($0, prefix) == 1 { print; exit }'
)"
GATEWAY_EXACT_IMAGE="$(
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' \
    "$TASK13_GATEWAY_IMAGE" |
    awk -v prefix="$GATEWAY_REPOSITORY@" 'index($0, prefix) == 1 { print; exit }'
)"
API_DIGEST="${API_EXACT_IMAGE#"$API_REPOSITORY@"}"
GATEWAY_DIGEST="${GATEWAY_EXACT_IMAGE#"$GATEWAY_REPOSITORY@"}"
if ! printf '%s' "$API_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "Task 13 API exact digest evidence is invalid."
  exit 1
fi
if ! printf '%s' "$GATEWAY_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
  echo "Task 13 Gateway exact digest evidence is invalid."
  exit 1
fi

API_REVISION="$(
  docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$TASK13_API_IMAGE"
)"
GATEWAY_REVISION="$(
  docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$TASK13_GATEWAY_IMAGE"
)"
API_BUILD_PAIR="$(
  docker image inspect \
    --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' \
    "$TASK13_API_IMAGE"
)"
GATEWAY_BUILD_PAIR="$(
  docker image inspect \
    --format '{{ index .Config.Labels "kt.kwitsukasa.top/build-pair" }}' \
    "$TASK13_GATEWAY_IMAGE"
)"
if [ "$API_REVISION" != "$TASK13_EXPECTED_SOURCE_COMMIT" ] ||
  [ "$GATEWAY_REVISION" != "$TASK13_EXPECTED_SOURCE_COMMIT" ]; then
  echo "Task 13 prebuilt image revision drifted from the checked-out commit."
  exit 1
fi
if [ -z "$API_BUILD_PAIR" ] ||
  [ "$API_BUILD_PAIR" != "$GATEWAY_BUILD_PAIR" ] ||
  [ "$API_BUILD_PAIR" != "$TASK13_EXPECTED_BUILD_PAIR" ]; then
  echo "Task 13 API and Gateway images do not share the expected build pair."
  exit 1
fi

mkdir -p -- "$EVIDENCE_DIR"
{
  printf 'API_IMAGE=%s\n' "$API_EXACT_IMAGE"
  printf 'GATEWAY_IMAGE=%s\n' "$GATEWAY_EXACT_IMAGE"
  printf 'SOURCE_REVISION=%s\n' "$API_REVISION"
  printf 'BUILD_PAIR=%s\n' "$API_BUILD_PAIR"
} >"$EVIDENCE_TEMP"
chmod 600 "$EVIDENCE_TEMP"
mv -f -- "$EVIDENCE_TEMP" "$EVIDENCE_FILE"
trap - EXIT HUP INT TERM
printf 'Task 13 exact digest evidence: %s\n' "$EVIDENCE_FILE"
