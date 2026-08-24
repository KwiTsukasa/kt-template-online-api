import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '../..');
const JENKINSFILE_PATH = resolve(REPO_ROOT, 'Jenkinsfile');
const TASK13_PREBUILD_PUSH_SCRIPT_PATH = resolve(
  REPO_ROOT,
  'ci/jenkins/task13-prebuild-push.sh',
);
const TASK13_PREBUILT_RELEASE_SCRIPT_PATH = resolve(
  REPO_ROOT,
  'ci/jenkins/task13-prebuilt-release.sh',
);
const jenkinsfile = readFileSync(JENKINSFILE_PATH, 'utf8');
const task13PrebuildPushScript = readFileSync(
  TASK13_PREBUILD_PUSH_SCRIPT_PATH,
  'utf8',
);
const task13PrebuiltReleaseScript = readFileSync(
  TASK13_PREBUILT_RELEASE_SCRIPT_PATH,
  'utf8',
);

// 本测试验证 Jenkinsfile 静态状态机和外部脚本的隔离故障行为；真实参数绑定、
// Docker Registry 与 K8s 行为仍必须由主线程在隔离的 Jenkins canary 中验证。
function extractBlockAfter(
  source: string,
  marker: string,
  fromIndex = 0,
): string {
  const markerIndex = source.indexOf(marker, fromIndex);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const openingBrace = source.indexOf('{', markerIndex + marker.length);
  expect(openingBrace).toBeGreaterThan(markerIndex);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed block after ${marker}`);
}

function extractStage(name: string): string {
  return extractBlockAfter(jenkinsfile, `stage('${name}')`);
}

function extractFunctionDefinition(source: string, name: string): string {
  const marker = `${name}()`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = extractBlockAfter(source, marker);
  const openingBrace = source.indexOf('{', start + marker.length);

  return source.slice(start, openingBrace + body.length + 2);
}

function renderPrebuiltApplyRecoveryScript(releaseScript: string): string {
  const applyMarker = 'kubectl_cmd apply -f "$RENDERED_MANIFEST"';
  const applyIndex = releaseScript.indexOf(applyMarker);
  expect(applyIndex).toBeGreaterThanOrEqual(0);
  const guardStart = releaseScript.lastIndexOf(
    'prebuilt_release_complete=false',
    applyIndex,
  );
  expect(guardStart).toBeGreaterThanOrEqual(0);
  const applyEnd = releaseScript.indexOf('\n', applyIndex);
  expect(applyEnd).toBeGreaterThan(applyIndex);

  return [
    'set -e',
    'SECRET_MANIFEST=',
    'OVERLAY_DIR="$TEST_OVERLAY_DIR"',
    'RENDERED_MANIFEST=rendered.yaml',
    "K8S_DEPLOYMENT='api'",
    "K8S_ROLLOUT_TIMEOUT='5s'",
    "REPLICAS_JSONPATH='{.spec.replicas}'",
    'kubectl_cmd() { kubectl "$@"; }',
    'deployment_value() { kubectl_cmd get "deployment/$K8S_DEPLOYMENT" -o "jsonpath=$1"; }',
    extractFunctionDefinition(releaseScript, 'cleanup_release_artifacts'),
    extractFunctionDefinition(releaseScript, 'restore_prebuilt_api_zero'),
    extractFunctionDefinition(releaseScript, 'finish_prebuilt_release'),
    releaseScript.slice(guardStart, applyEnd),
  ].join('\n');
}

function runPrebuiltApplyFailure(
  releaseScript: string,
  failureMode: 'exit' | 'hup' | 'int' | 'term',
) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'kt-jenkins-apply-recovery-'),
  );
  const overlayDirectory = join(temporaryDirectory, 'overlay');
  mkdirSync(overlayDirectory);
  const traceFile = join(temporaryDirectory, 'kubectl.trace');
  const kubectlStub = `
    kubectl() {
      printf '%s\\n' "$*" >> "$TRACE_FILE"
      case " $* " in
        *" apply -f rendered.yaml "*)
          if [ "$FAILURE_MODE" != "exit" ]; then
            kill "-$FAILURE_MODE" "$$"
          fi
          return 17
          ;;
        *" get deployment/api -o jsonpath={.spec.replicas} "*)
          printf '0'
          ;;
      esac
      return 0
    }
  `;

  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `${kubectlStub}\n${renderPrebuiltApplyRecoveryScript(releaseScript)}`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          FAILURE_MODE: failureMode.toUpperCase(),
          TEST_OVERLAY_DIR: overlayDirectory,
          TRACE_FILE: traceFile,
        },
      },
    );
    return {
      result,
      overlayExists: existsSync(overlayDirectory),
      trace: readFileSync(traceFile, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function runPrebuildEvidenceSignal() {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'kt-jenkins-prebuild-signal-'),
  );
  const apiRepository = 'k3d-kt-registry.localhost:5000/kt-template-online-api';
  const gatewayRepository =
    'k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway';
  const digest = `sha256:${'a'.repeat(64)}`;
  const sourceCommit = 'b'.repeat(40);
  const buildPair = `${sourceCommit}:1`;
  const evidenceTemporaryFile = join(
    temporaryDirectory,
    '.kt-workspace/task13-prebuild/task13-exact-digests.env.tmp',
  );
  const shell = `
    docker() {
      case "$*" in
        "push "*) return 0 ;;
        *"RepoDigests"*"$TASK13_API_IMAGE"*)
          printf '%s\\n' "${apiRepository}@${digest}"
          ;;
        *"RepoDigests"*"$TASK13_GATEWAY_IMAGE"*)
          printf '%s\\n' "${gatewayRepository}@${digest}"
          ;;
        *"org.opencontainers.image.revision"*)
          printf '%s\\n' "$TASK13_EXPECTED_SOURCE_COMMIT"
          ;;
        *"kt.kwitsukasa.top/build-pair"*)
          printf '%s\\n' "$TASK13_EXPECTED_BUILD_PAIR"
          ;;
        *) return 1 ;;
      esac
    }
    chmod() {
      kill -TERM "$$"
    }
    . "$TASK13_SCRIPT"
  `;

  try {
    const result = spawnSync('sh', ['-c', shell], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        TASK13_API_IMAGE: `${apiRepository}:test`,
        TASK13_GATEWAY_IMAGE: `${gatewayRepository}:test`,
        TASK13_EXPECTED_BUILD_PAIR: buildPair,
        TASK13_EXPECTED_SOURCE_COMMIT: sourceCommit,
        TASK13_SCRIPT: TASK13_PREBUILD_PUSH_SCRIPT_PATH,
      },
    });

    return {
      result,
      evidenceTemporaryFileExists: existsSync(evidenceTemporaryFile),
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function runSecretCreateFailure(releaseScript: string) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'kt-jenkins-secret-create-'),
  );
  const traceFile = join(temporaryDirectory, 'kubectl.trace');
  const secretStart = releaseScript.indexOf('SECRET_MANIFEST="$(');
  expect(secretStart).toBeGreaterThanOrEqual(0);
  const unsetMarker = 'unset SECRET_MANIFEST';
  const unsetIndex = releaseScript.indexOf(unsetMarker, secretStart);
  expect(unsetIndex).toBeGreaterThan(secretStart);
  const secretApply = releaseScript.slice(
    secretStart,
    unsetIndex + unsetMarker.length,
  );
  const shell = `
    set -e
    K8S_ENV_SECRET=secret
    CONTAINER_ENV_FILE=production.env
    KUBECONFIG=kubeconfig
    kubectl_cmd() {
      printf '%s\\n' "$*" >> "$TRACE_FILE"
      return 17
    }
    kubectl() {
      printf '%s\\n' "$*" >> "$TRACE_FILE"
      return 0
    }
    ${secretApply}
  `;

  try {
    const result = spawnSync('sh', ['-c', shell], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
      },
    });

    return {
      result,
      trace: readFileSync(traceFile, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

describe('Jenkins exact-digest prebuilt release contract', () => {
  it('pins release identity to the explicit checkout result and workspace HEAD', () => {
    const checkout = extractStage('Checkout');

    expect(checkout).toContain('def checkoutMetadata = checkout scm');
    expect(checkout).toContain('checkoutMetadata.GIT_COMMIT?.trim()');
    expect(checkout).toMatch(
      /sh\(\s*script: 'git rev-parse HEAD',\s*returnStdout: true,\s*\)\.trim\(\)/,
    );
    expect(checkout).toContain('env.CHECKED_OUT_GIT_COMMIT = checkedOutCommit');
    expect(jenkinsfile).not.toContain('env.GIT_COMMIT');
  });

  it('authenticates remote main and dev verification with the SCM credential', () => {
    const helper = extractBlockAfter(
      jenkinsfile,
      'def readRemotePublishHeads()',
    );
    const prepare = extractStage('Prepare');

    expect(helper).toContain(
      "sshagent(credentials: ['github-ssh-kt-template'])",
    );
    expect(helper).toContain(
      'git ls-remote --exit-code --heads origin refs/heads/main refs/heads/dev',
    );
    expect(prepare.match(/readRemotePublishHeads\(\)/g)).toHaveLength(2);
    expect(prepare).not.toContain('def remoteHeadsRaw = sh(');
  });

  it('keeps CPS-heavy release logic in bounded executable scripts', () => {
    expect(Buffer.byteLength(jenkinsfile)).toBeLessThanOrEqual(36_000);
    expect(extractStage('Docker Push')).toContain(
      './ci/jenkins/task13-prebuild-push.sh',
    );
    expect(extractStage('K8s Deploy')).toContain(
      './ci/jenkins/task13-prebuilt-release.sh',
    );
    expect(task13PrebuiltReleaseScript).toContain('api_images != 3');

    for (const [path, script] of [
      [TASK13_PREBUILD_PUSH_SCRIPT_PATH, task13PrebuildPushScript],
      [TASK13_PREBUILT_RELEASE_SCRIPT_PATH, task13PrebuiltReleaseScript],
    ] as const) {
      expect(script.startsWith('#!/bin/sh\nset -eu\n')).toBe(true);
      expect(script).not.toMatch(/\beval\b/);
      expect(statSync(path).mode & 0o111).not.toBe(0);
    }

    for (const fixedContract of [
      "KUBECONFIG='/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml'",
      "CONTAINER_ENV_FILE='/home/jenkins/agent/env/kt-template-online-api/.env.production'",
      "K8S_MANIFEST_FILE='k8s/prod/api.yaml'",
      "K8S_NAMESPACE='kt-prod'",
      "K8S_DEPLOYMENT='kt-template-online-api'",
      "K8S_ENV_SECRET='kt-template-online-api-env'",
      "K8S_ROLLOUT_TIMEOUT='180s'",
    ]) {
      expect(task13PrebuiltReleaseScript).toContain(fixedContract);
    }
  });

  it('keeps the explicit Task 13 build-only mode without blocking later main releases', () => {
    const prepare = extractStage('Prepare');

    expect(jenkinsfile).toContain(
      "booleanParam(name: 'TASK13_PREBUILD_ONLY', defaultValue: false",
    );
    expect(prepare).toContain(
      'TASK13_PREBUILD_ONLY cannot be combined with PREBUILT_RELEASE.',
    );
    expect(prepare).toContain(
      "error('TASK13_PREBUILD_ONLY requires the Linux/NAS Jenkins Agent.')",
    );
    expect(prepare).toContain(
      'TASK13_PREBUILD_ONLY is limited to the non-PR canonical main publish branch.',
    );
    expect(prepare).toContain("'DEPLOY_TARGET': 'docker'");
    expect(prepare).toContain("'BUILD_DOCKER_IMAGE': true");
    expect(prepare).toContain("'PUSH_DOCKER_IMAGE': true");
    expect(prepare).toContain("'RUN_DOCKER_CONTAINER': false");
    expect(prepare).toContain("'IMAGE_TAG': ''");
    expect(prepare).toContain(
      'Remote main/dev must both equal the checked-out commit before TASK13_PREBUILD_ONLY.',
    );
    expect(prepare).not.toContain(
      'Task 13 blocks ordinary main deployment; select TASK13_PREBUILD_ONLY or PREBUILT_RELEASE explicitly.',
    );
    expect(prepare).not.toMatch(
      /env\.BRANCH_NAME == 'main'[\s\S]*!params\.PREBUILT_RELEASE[\s\S]*!params\.TASK13_PREBUILD_ONLY[\s\S]*Task 13 blocks ordinary main deployment/,
    );
  });

  it('builds and pushes exact API/Gateway evidence without entering either deploy stage', () => {
    const dockerBuild = extractStage('Docker Build');
    const dockerPush = extractStage('Docker Push');
    const k8sDeploy = extractStage('K8s Deploy');
    const dockerRun = extractStage('Docker Run');

    expect(dockerBuild).toContain(
      'org.opencontainers.image.revision=${shellQuote(env.CHECKED_OUT_GIT_COMMIT)}',
    );
    expect(dockerBuild).toContain(
      'kt.kwitsukasa.top/build-pair=${shellQuote(env.IMAGE_BUILD_PAIR)}',
    );
    expect(dockerPush).toContain("if (env.IS_TASK13_PREBUILD_ONLY == 'true')");
    expect(task13PrebuildPushScript).toContain(
      "EVIDENCE_DIR='.kt-workspace/task13-prebuild'",
    );
    expect(task13PrebuildPushScript).toContain(
      'EVIDENCE_FILE="$EVIDENCE_DIR/task13-exact-digests.env"',
    );
    expect(task13PrebuildPushScript).toContain('API_IMAGE=');
    expect(task13PrebuildPushScript).toContain('GATEWAY_IMAGE=');
    expect(task13PrebuildPushScript).toContain('SOURCE_REVISION=');
    expect(task13PrebuildPushScript).toContain('BUILD_PAIR=');
    expect(k8sDeploy).toContain("env.IS_TASK13_PREBUILD_ONLY != 'true'");
    expect(dockerRun).toContain("env.IS_TASK13_PREBUILD_ONLY != 'true'");
    expect(jenkinsfile).toContain(
      '.kt-workspace/task13-prebuild/task13-exact-digests.env',
    );
  });

  it('exits non-zero and cleans partial digest evidence on TERM', () => {
    const { evidenceTemporaryFileExists, result } = runPrebuildEvidenceSignal();

    expect(result.status).not.toBe(0);
    expect(evidenceTemporaryFileExists).toBe(false);
  });

  it('rejects both NapCat overrides in both Task 13 restricted modes', () => {
    const prepare = extractStage('Prepare');

    expect(prepare).toContain(
      "def restrictedOverrideParameters = [\n              'NAPCAT_IMAGE_OVERRIDE',\n              'NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE',",
    );
    expect(prepare).toContain('params[parameterName]?.trim()');
    expect(prepare).toContain(
      '${parameterName} must be empty in Task 13 restricted modes.',
    );
  });

  it('requires two pinned images and the exact checked-out source commit', () => {
    expect(jenkinsfile).toContain(
      "booleanParam(name: 'PREBUILT_RELEASE', defaultValue: false",
    );
    expect(jenkinsfile).toContain("string(name: 'PREBUILT_API_IMAGE'");
    expect(jenkinsfile).toContain(
      "string(name: 'PREBUILT_MIGRATION_API_IMAGE'",
    );
    expect(jenkinsfile).toContain("string(name: 'PREBUILT_FALLBACK_API_IMAGE'");
    expect(jenkinsfile).toContain("string(name: 'PREBUILT_GATEWAY_IMAGE'");
    expect(jenkinsfile).toContain("string(name: 'EXPECTED_SOURCE_COMMIT'");
    expect(jenkinsfile).toContain("string(name: 'TASK13_MIGRATION_BATCH_ID'");
    expect(jenkinsfile).toMatch(
      /def isDigestPinnedImage[\s\S]*@sha256:\[0-9a-f\]\{64\}/,
    );
    expect(jenkinsfile).toMatch(
      /expectedSourceCommit ==~ \/\[0-9a-f\]\{40\}\//,
    );
    expect(jenkinsfile).toContain(
      "sh(script: 'git rev-parse HEAD', returnStdout: true).trim()",
    );
    expect(jenkinsfile).toContain(
      'if (checkedOutCommit != expectedSourceCommit)',
    );
    expect(jenkinsfile).toContain(
      'git status --porcelain=v1 --untracked-files=all',
    );
    expect(jenkinsfile).toContain(
      'PREBUILT_RELEASE requires a clean checkout.',
    );
    expect(jenkinsfile).toContain("env.BRANCH_NAME != 'main'");
    expect(jenkinsfile).toContain(
      'git ls-remote --exit-code --heads origin refs/heads/main refs/heads/dev',
    );
    expect(jenkinsfile).toContain(
      'Remote main/dev must both equal EXPECTED_SOURCE_COMMIT',
    );
    expect(jenkinsfile).toContain(
      'TASK13_MIGRATION_BATCH_ID must be an explicit UTC Task 13 batch identifier.',
    );
  });

  it('limits prebuilt releases to the canonical Linux/NAS K8s path', () => {
    const prepare = extractStage('Prepare');

    expect(prepare).toContain("params.DEPLOY_TARGET != 'k8s'");
    expect(prepare).toContain(
      "'KUBE_CONFIG_FILE': '/home/jenkins/agent/kubeconfig/kt-nas.jenkins.yaml'",
    );
    expect(prepare).toContain("'K8S_MANIFEST_FILE': 'k8s/prod/api.yaml'");
    expect(prepare).toContain("'K8S_NAMESPACE': 'kt-prod'");
    expect(prepare).toContain("'K8S_DEPLOYMENT': 'kt-template-online-api'");
    expect(prepare).toContain("'K8S_CONTAINER': 'api'");
    expect(prepare).toContain("'K8S_ENV_SECRET': 'kt-template-online-api-env'");
    expect(prepare).toContain("'K8S_ROLLOUT_TIMEOUT': '180s'");
    expect(prepare).toContain(
      "'CONTAINER_ENV_FILE': '/home/jenkins/agent/env/kt-template-online-api/.env.production'",
    );
    expect(prepare).toContain(
      "error('PREBUILT_RELEASE requires the Linux/NAS Jenkins Agent.')",
    );
  });

  it.each(['Install', 'Lint', 'Test', 'Build', 'Docker Build', 'Docker Push'])(
    'skips %s in prebuilt release mode',
    (stageName) => {
      expect(extractStage(stageName)).toContain(
        "env.IS_PREBUILT_RELEASE != 'true'",
      );
    },
  );

  it('renders and validates a temporary zero-replica digest overlay before apply', () => {
    expect(task13PrebuiltReleaseScript).toContain(
      'mktemp -d .jenkins-kustomize.',
    );
    expect(task13PrebuiltReleaseScript).toContain('kustomization.yaml');
    expect(task13PrebuiltReleaseScript).toContain('kubectl kustomize');
    expect(task13PrebuiltReleaseScript).toContain('path: /spec/replicas');
    expect(task13PrebuiltReleaseScript).toContain('value: 0');
    expect(task13PrebuiltReleaseScript).toContain('api_image');
    expect(task13PrebuiltReleaseScript).toContain('gateway_image');
    expect(task13PrebuiltReleaseScript).toContain(
      'kubectl_cmd apply -f "$RENDERED_MANIFEST"',
    );
    expect(task13PrebuiltReleaseScript).not.toContain('kubectl set image');
  });

  it('validates the read-only maintenance gate before the first production write', () => {
    const secretCreate = task13PrebuiltReleaseScript.indexOf(
      'create secret generic',
    );
    const maintenanceGate = task13PrebuiltReleaseScript.indexOf(
      'Task 13 maintenance lease is not active.',
    );
    const zeroPodsGate = task13PrebuiltReleaseScript.indexOf(
      'Task 13 maintenance requires zero API Pods.',
    );
    const render = task13PrebuiltReleaseScript.indexOf('kubectl kustomize');
    const apply = task13PrebuiltReleaseScript.indexOf(
      'kubectl_cmd apply -f "$RENDERED_MANIFEST"',
    );
    const scale = task13PrebuiltReleaseScript.indexOf(
      'scale "deployment/$K8S_DEPLOYMENT" --replicas=1',
    );
    const apiRollout = task13PrebuiltReleaseScript.indexOf(
      'rollout status "deployment/$K8S_DEPLOYMENT"',
    );

    expect(secretCreate).toBeGreaterThanOrEqual(0);
    expect(maintenanceGate).toBeGreaterThanOrEqual(0);
    expect(zeroPodsGate).toBeGreaterThanOrEqual(0);
    expect(secretCreate).toBeGreaterThan(maintenanceGate);
    expect(secretCreate).toBeGreaterThan(zeroPodsGate);
    expect(render).toBeGreaterThan(secretCreate);
    expect(apply).toBeGreaterThan(render);
    expect(scale).toBeGreaterThan(apply);
    expect(apiRollout).toBeGreaterThan(scale);
    expect(task13PrebuiltReleaseScript.match(/--replicas=1/g)).toHaveLength(1);
    expect(task13PrebuiltReleaseScript).toContain(
      'Prebuilt API deployment was not applied at zero replicas.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Prebuilt API deployment image does not match the requested digest.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Prebuilt Gateway deployment image does not match the requested digest.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Task 13 maintenance lease is not active.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Task 13 maintenance batch does not match the release.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Task 13 maintenance image does not match the migration digest.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'SECRET_MANIFEST="$(\n  kubectl_cmd create secret generic',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'printf \'%s\\n\' "$SECRET_MANIFEST" |',
    );
    expect(task13PrebuiltReleaseScript).toContain('unset SECRET_MANIFEST');
    expect(task13PrebuiltReleaseScript).not.toContain('.jenkins-task13-secret');
  });

  it('does not apply a Secret when client-side generation fails', () => {
    const { result, trace } = runSecretCreateFailure(
      task13PrebuiltReleaseScript,
    );

    expect(result.status).not.toBe(0);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toContain('create secret generic secret');
    expect(trace).not.toContain('apply -f -');
  });

  it('binds both release images to one immutable source/build pair', () => {
    const dockerBuild = extractStage('Docker Build');
    expect(
      dockerBuild.match(/org\.opencontainers\.image\.revision/g),
    ).toHaveLength(2);
    expect(dockerBuild.match(/kt\.kwitsukasa\.top\/build-pair/g)).toHaveLength(
      2,
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'docker pull "$TASK13_MIGRATION_API_IMAGE"',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'docker pull "$TASK13_GATEWAY_IMAGE"',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'API and Gateway images are not from the same build.',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Target image revision does not match EXPECTED_SOURCE_COMMIT.',
    );
  });

  it('allows only the migration digest or its pre-approved fallback digest', () => {
    const prepare = extractStage('Prepare');
    expect(prepare).toContain(
      'extractDigestSuffix(migrationApiImage) == extractDigestSuffix(fallbackApiImage)',
    );
    expect(prepare).toContain(
      'PREBUILT_API_IMAGE must equal the migration image or approved fallback image.',
    );
    expect(task13PrebuiltReleaseScript).toContain('task13-fallback-image');
    expect(task13PrebuiltReleaseScript).toContain('TASK13_FALLBACK_API_IMAGE');
    expect(task13PrebuiltReleaseScript).toContain('TASK13_MIGRATION_API_IMAGE');
    expect(task13PrebuiltReleaseScript).toContain(
      'MIGRATION_IMAGE_ID="$(docker image inspect --format',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'FALLBACK_IMAGE_ID="$(docker image inspect --format',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Migration and fallback images resolve to the same Docker image ID.',
    );
    const imageIdGate = task13PrebuiltReleaseScript.indexOf(
      'Migration and fallback images resolve to the same Docker image ID.',
    );
    const firstK8sWrite = task13PrebuiltReleaseScript.indexOf(
      'create secret generic',
    );
    expect(imageIdGate).toBeGreaterThanOrEqual(0);
    expect(firstK8sWrite).toBeGreaterThan(imageIdGate);
  });

  it('verifies env and migration completion attestations before Secret apply', () => {
    const secretCreate = task13PrebuiltReleaseScript.indexOf(
      'create secret generic',
    );
    const envFingerprint = task13PrebuiltReleaseScript.indexOf(
      'Task 13 production env fingerprint does not match migration.',
    );
    const offNas = task13PrebuiltReleaseScript.indexOf(
      'Task 13 off-NAS backup attestation is missing.',
    );
    const blogVerified = task13PrebuiltReleaseScript.indexOf(
      'Task 13 Blog verification attestation is missing.',
    );
    const adminVerified = task13PrebuiltReleaseScript.indexOf(
      'Task 13 Admin verification attestation is missing.',
    );

    for (const gate of [envFingerprint, offNas, blogVerified, adminVerified]) {
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(secretCreate).toBeGreaterThan(gate);
    }
    expect(task13PrebuiltReleaseScript).toContain("stat -c '%a'");
    expect(task13PrebuiltReleaseScript).toContain("stat -c '%u'");
  });

  it('restores API to zero when either rollout fails', () => {
    const trap = task13PrebuiltReleaseScript.indexOf(
      'trap finish_prebuilt_release EXIT',
    );
    const apiRollout = task13PrebuiltReleaseScript.indexOf(
      'rollout status "deployment/$K8S_DEPLOYMENT"',
    );
    const gatewayRollout = task13PrebuiltReleaseScript.indexOf(
      'rollout status "deployment/$GATEWAY_DEPLOYMENT"',
    );
    const complete = task13PrebuiltReleaseScript.indexOf(
      'prebuilt_release_complete=true',
    );

    expect(trap).toBeGreaterThanOrEqual(0);
    expect(apiRollout).toBeGreaterThan(trap);
    expect(gatewayRollout).toBeGreaterThan(apiRollout);
    expect(complete).toBeGreaterThan(gatewayRollout);
    expect(task13PrebuiltReleaseScript).toContain(
      'scale "deployment/$K8S_DEPLOYMENT" --replicas=0',
    );
    expect(task13PrebuiltReleaseScript).toContain(
      'Prebuilt release recovery could not restore API to zero.',
    );
  });

  it('guards the manifest apply and every post-apply readback with zero-replica recovery', () => {
    const overlayApply = task13PrebuiltReleaseScript.indexOf(
      'kubectl_cmd apply -f "$RENDERED_MANIFEST"',
    );
    const overlayExitTrap = task13PrebuiltReleaseScript.lastIndexOf(
      'trap finish_prebuilt_release EXIT',
      overlayApply,
    );
    const overlaySignalTrap = task13PrebuiltReleaseScript.lastIndexOf(
      "trap 'exit 1' HUP INT TERM",
      overlayApply,
    );
    const trap = overlayExitTrap;
    const firstReadback = task13PrebuiltReleaseScript.indexOf(
      'Prebuilt API deployment was not applied at zero replicas.',
    );

    expect(overlayExitTrap).toBeGreaterThanOrEqual(0);
    expect(overlayExitTrap).toBeLessThan(overlayApply);
    expect(overlaySignalTrap).toBeGreaterThanOrEqual(0);
    expect(overlaySignalTrap).toBeGreaterThan(overlayExitTrap);
    expect(overlaySignalTrap).toBeLessThan(overlayApply);
    expect(trap).toBeGreaterThanOrEqual(0);
    expect(trap).toBeLessThan(firstReadback);
  });

  it.each(['exit', 'hup', 'int', 'term'] as const)(
    'executes zero-replica compensation when manifest apply fails by %s',
    (failureMode) => {
      const { result, overlayExists, trace } = runPrebuiltApplyFailure(
        task13PrebuiltReleaseScript,
        failureMode,
      );
      const apply = trace.findIndex((line) =>
        line.includes('apply -f rendered.yaml'),
      );
      const scaleZero = trace.findIndex((line) =>
        line.includes('scale deployment/api --replicas=0'),
      );

      expect(result.status).not.toBe(0);
      expect(apply).toBeGreaterThanOrEqual(0);
      expect(scaleZero).toBeGreaterThan(apply);
      expect(overlayExists).toBe(false);
      expect(trace).toContain(
        'get deployment/api -o jsonpath={.spec.replicas}',
      );
      expect(
        trace.filter((line) => line.includes('get pods -l app=api -o name')),
      ).toHaveLength(2);
      expect(result.stderr).not.toContain(
        'Prebuilt release recovery could not restore API to zero.',
      );
    },
  );

  it('applies one exact API image across the container and both initContainers', () => {
    const deploy = extractStage('K8s Deploy');

    expect(deploy).toContain(
      's|k3d-kt-registry.localhost:5000/kt-template-online-api:latest|${env.DOCKER_IMAGE}|g',
    );
    expect(deploy).toContain('| kubectl ${kubeConfigArg} apply -f -');
    expect(deploy).not.toContain(
      'set image ${shellQuote("deployment/${deploymentName}")}',
    );
    expect(deploy).toContain(
      "set image ${shellQuote('deployment/kt-napcat-webui-gateway')}",
    );
    expect(deploy).toContain(
      "params.BUILD_DOCKER_IMAGE || env.IS_PREBUILT_RELEASE == 'true'",
    );
  });
});
