import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '../..');
const jenkinsfile = readFileSync(resolve(REPO_ROOT, 'Jenkinsfile'), 'utf8');

// 本测试只验证 Jenkinsfile 的静态状态机；真实参数绑定、Docker Registry 与 K8s
// 行为仍必须由主线程在隔离的 Jenkins canary 中验证。
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

function renderPrebuiltApplyRecoveryScript(deploy: string): string {
  const applyMarker =
    'kubectl ${kubeConfigArg} apply -f "\\$RENDERED_MANIFEST"';
  const applyIndex = deploy.indexOf(applyMarker);
  expect(applyIndex).toBeGreaterThanOrEqual(0);
  const recoveryStart = deploy.lastIndexOf(
    'restore_prebuilt_api_zero() {',
    applyIndex,
  );
  expect(recoveryStart).toBeGreaterThanOrEqual(0);
  const signalTrapStart = deploy.lastIndexOf(
    "trap 'exit 1' HUP INT TERM",
    recoveryStart,
  );
  expect(signalTrapStart).toBeGreaterThanOrEqual(0);
  const signalTrapEnd = deploy.indexOf('\n', signalTrapStart);
  expect(signalTrapEnd).toBeGreaterThan(signalTrapStart);
  const applyEnd = deploy.indexOf('\n', applyIndex);
  expect(applyEnd).toBeGreaterThan(applyIndex);

  const replacements = new Map([
    ['${kubeConfigArg}', ''],
    ['${namespaceArg}', ''],
    ['${shellQuote("deployment/${deploymentName}")}', "'deployment/api'"],
    ['${shellQuote("app=${deploymentName}")}', "'app=api'"],
    ['${shellQuote(rolloutTimeout)}', "'5s'"],
    ['${shellQuote(replicasJsonPath)}', "'{.spec.replicas}'"],
  ]);
  let recoveryScript = deploy.slice(recoveryStart, applyEnd);
  for (const [source, replacement] of replacements) {
    recoveryScript = recoveryScript.replaceAll(source, replacement);
  }

  return [
    'set -e',
    'cleanup_overlay() { :; }',
    'RENDERED_MANIFEST=rendered.yaml',
    deploy.slice(signalTrapStart, signalTrapEnd).trim(),
    recoveryScript.replaceAll('\\$', '$'),
  ].join('\n');
}

function runPrebuiltApplyFailure(deploy: string, failureMode: 'exit' | 'term') {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'kt-jenkins-apply-recovery-'),
  );
  const traceFile = join(temporaryDirectory, 'kubectl.trace');
  const kubectlStub = `
    kubectl() {
      printf '%s\\n' "$*" >> "$TRACE_FILE"
      case " $* " in
        *" apply -f rendered.yaml "*)
          if [ "$FAILURE_MODE" = "term" ]; then
            kill -TERM "$$"
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
      ['-c', `${kubectlStub}\n${renderPrebuiltApplyRecoveryScript(deploy)}`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          FAILURE_MODE: failureMode,
          TRACE_FILE: traceFile,
        },
      },
    );
    return {
      result,
      trace: readFileSync(traceFile, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

describe('Jenkins exact-digest prebuilt release contract', () => {
  it('defines a fail-closed Task 13 build-only mode', () => {
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
    expect(prepare).toContain(
      'Task 13 blocks ordinary main deployment; select TASK13_PREBUILD_ONLY or PREBUILT_RELEASE explicitly.',
    );
    expect(prepare).toMatch(
      /env\.BRANCH_NAME == 'main'[\s\S]*!params\.PREBUILT_RELEASE[\s\S]*!params\.TASK13_PREBUILD_ONLY[\s\S]*Task 13 blocks ordinary main deployment/,
    );
  });

  it('builds and pushes exact API/Gateway evidence without entering either deploy stage', () => {
    const dockerBuild = extractStage('Docker Build');
    const dockerPush = extractStage('Docker Push');
    const k8sDeploy = extractStage('K8s Deploy');
    const dockerRun = extractStage('Docker Run');

    expect(dockerBuild).toContain(
      'org.opencontainers.image.revision=${shellQuote(env.GIT_COMMIT)}',
    );
    expect(dockerBuild).toContain(
      'kt.kwitsukasa.top/build-pair=${shellQuote(env.IMAGE_BUILD_PAIR)}',
    );
    expect(dockerPush).toContain("if (env.IS_TASK13_PREBUILD_ONLY == 'true')");
    expect(dockerPush).toContain('task13-exact-digests.env');
    expect(dockerPush).toContain('API_IMAGE=');
    expect(dockerPush).toContain('GATEWAY_IMAGE=');
    expect(dockerPush).toContain('SOURCE_REVISION=');
    expect(dockerPush).toContain('BUILD_PAIR=');
    expect(k8sDeploy).toContain("env.IS_TASK13_PREBUILD_ONLY != 'true'");
    expect(dockerRun).toContain("env.IS_TASK13_PREBUILD_ONLY != 'true'");
    expect(jenkinsfile).toContain(
      '.kt-workspace/task13-prebuild/task13-exact-digests.env',
    );
  });

  it('rejects both NapCat overrides in both Task 13 restricted modes', () => {
    const prepare = extractStage('Prepare');

    expect(prepare).toContain(
      "def restrictedOverrideParameters = [\n              'QQBOT_NAPCAT_IMAGE_OVERRIDE',\n              'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE',",
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
    const deploy = extractStage('K8s Deploy');
    const prebuiltMarker = "if (env.IS_PREBUILT_RELEASE == 'true')";
    const readOnlyGateIndex = deploy.indexOf(prebuiltMarker);
    const prebuiltDeploy = extractBlockAfter(
      deploy,
      prebuiltMarker,
      readOnlyGateIndex + prebuiltMarker.length,
    );

    expect(prebuiltDeploy).toContain('mktemp -d .jenkins-kustomize.');
    expect(prebuiltDeploy).toContain('kustomization.yaml');
    expect(prebuiltDeploy).toContain('kubectl kustomize');
    expect(prebuiltDeploy).toContain('path: /spec/replicas');
    expect(prebuiltDeploy).toContain('value: 0');
    expect(prebuiltDeploy).toContain('api_image');
    expect(prebuiltDeploy).toContain('gateway_image');
    expect(prebuiltDeploy).toContain(
      'kubectl ${kubeConfigArg} apply -f "\\$RENDERED_MANIFEST"',
    );
    expect(prebuiltDeploy).not.toContain('kubectl set image');
  });

  it('validates the read-only maintenance gate before the first production write', () => {
    const deploy = extractStage('K8s Deploy');
    const secretCreate = deploy.indexOf('create secret generic');
    const maintenanceGate = deploy.indexOf(
      'Task 13 maintenance lease is not active.',
    );
    const zeroPodsGate = deploy.indexOf(
      'Task 13 maintenance requires zero API Pods.',
    );
    const render = deploy.indexOf('kubectl kustomize');
    const apply = deploy.indexOf(
      'kubectl ${kubeConfigArg} apply -f "\\$RENDERED_MANIFEST"',
    );
    const scale = deploy.indexOf(
      'scale ${shellQuote("deployment/${deploymentName}")} --replicas=1',
    );
    const apiRollout = deploy.indexOf(
      'rollout status ${shellQuote("deployment/${deploymentName}")}',
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
    expect(deploy.match(/--replicas=1/g)).toHaveLength(1);
    expect(deploy).toContain(
      'Prebuilt API deployment was not applied at zero replicas.',
    );
    expect(deploy).toContain(
      'Prebuilt API deployment image does not match the requested digest.',
    );
    expect(deploy).toContain(
      'Prebuilt Gateway deployment image does not match the requested digest.',
    );
    expect(deploy).toContain('Task 13 maintenance lease is not active.');
    expect(deploy).toContain(
      'Task 13 maintenance batch does not match the release.',
    );
    expect(deploy).toContain(
      'Task 13 maintenance image does not match the migration digest.',
    );
  });

  it('binds both release images to one immutable source/build pair', () => {
    const dockerBuild = extractStage('Docker Build');
    const deploy = extractStage('K8s Deploy');

    expect(
      dockerBuild.match(/org\.opencontainers\.image\.revision/g),
    ).toHaveLength(2);
    expect(dockerBuild.match(/kt\.kwitsukasa\.top\/build-pair/g)).toHaveLength(
      2,
    );
    expect(deploy).toContain(
      'docker pull ${shellQuote(env.MIGRATION_API_IMAGE)}',
    );
    expect(deploy).toContain(
      'docker pull ${shellQuote(env.GATEWAY_DOCKER_IMAGE)}',
    );
    expect(deploy).toContain(
      'API and Gateway images are not from the same build.',
    );
    expect(deploy).toContain(
      'Target image revision does not match EXPECTED_SOURCE_COMMIT.',
    );
  });

  it('allows only the migration digest or its pre-approved fallback digest', () => {
    const prepare = extractStage('Prepare');
    const deploy = extractStage('K8s Deploy');

    expect(prepare).toContain(
      'extractDigestSuffix(migrationApiImage) == extractDigestSuffix(fallbackApiImage)',
    );
    expect(prepare).toContain(
      'PREBUILT_API_IMAGE must equal the migration image or approved fallback image.',
    );
    expect(deploy).toContain('task13-fallback-image');
    expect(deploy).toContain('env.FALLBACK_API_IMAGE');
    expect(deploy).toContain('env.MIGRATION_API_IMAGE');
    expect(deploy).toContain(
      'MIGRATION_IMAGE_ID="\\$(docker image inspect --format',
    );
    expect(deploy).toContain(
      'FALLBACK_IMAGE_ID="\\$(docker image inspect --format',
    );
    expect(deploy).toContain(
      'Migration and fallback images resolve to the same Docker image ID.',
    );
    const imageIdGate = deploy.indexOf(
      'Migration and fallback images resolve to the same Docker image ID.',
    );
    const firstK8sWrite = deploy.indexOf('create secret generic');
    expect(imageIdGate).toBeGreaterThanOrEqual(0);
    expect(firstK8sWrite).toBeGreaterThan(imageIdGate);
  });

  it('verifies env and migration completion attestations before Secret apply', () => {
    const deploy = extractStage('K8s Deploy');
    const secretCreate = deploy.indexOf('create secret generic');
    const envFingerprint = deploy.indexOf(
      'Task 13 production env fingerprint does not match migration.',
    );
    const offNas = deploy.indexOf(
      'Task 13 off-NAS backup attestation is missing.',
    );
    const blogVerified = deploy.indexOf(
      'Task 13 Blog verification attestation is missing.',
    );
    const adminVerified = deploy.indexOf(
      'Task 13 Admin verification attestation is missing.',
    );

    for (const gate of [envFingerprint, offNas, blogVerified, adminVerified]) {
      expect(gate).toBeGreaterThanOrEqual(0);
      expect(secretCreate).toBeGreaterThan(gate);
    }
    expect(deploy).toContain("stat -c '%a'");
    expect(deploy).toContain("stat -c '%u'");
  });

  it('restores API to zero when either rollout fails', () => {
    const deploy = extractStage('K8s Deploy');
    const finalRelease = deploy.lastIndexOf(
      "if (env.IS_PREBUILT_RELEASE == 'true')",
    );
    const releaseBlock = extractBlockAfter(
      deploy,
      "if (env.IS_PREBUILT_RELEASE == 'true')",
      finalRelease,
    );
    const trap = releaseBlock.indexOf('trap restore_prebuilt_api_zero EXIT');
    const apiRollout = releaseBlock.indexOf(
      'rollout status ${shellQuote("deployment/${deploymentName}")}',
    );
    const gatewayRollout = releaseBlock.indexOf(
      "rollout status ${shellQuote('deployment/kt-napcat-webui-gateway')}",
    );
    const complete = releaseBlock.indexOf('prebuilt_release_complete=true');

    expect(trap).toBeGreaterThanOrEqual(0);
    expect(apiRollout).toBeGreaterThan(trap);
    expect(gatewayRollout).toBeGreaterThan(apiRollout);
    expect(complete).toBeGreaterThan(gatewayRollout);
    expect(releaseBlock).toContain(
      'scale ${shellQuote("deployment/${deploymentName}")} --replicas=0',
    );
    expect(releaseBlock).toContain(
      'Prebuilt release recovery could not restore API to zero.',
    );
  });

  it('guards the manifest apply and every post-apply readback with zero-replica recovery', () => {
    const deploy = extractStage('K8s Deploy');
    const overlayApply = deploy.indexOf(
      'kubectl ${kubeConfigArg} apply -f "\\$RENDERED_MANIFEST"',
    );
    const overlayExitTrap = deploy.lastIndexOf(
      'trap finish_prebuilt_apply EXIT',
      overlayApply,
    );
    const overlaySignalTrap = deploy.lastIndexOf(
      "trap 'exit 1' HUP INT TERM",
      overlayApply,
    );
    const finalRelease = deploy.lastIndexOf(
      "if (env.IS_PREBUILT_RELEASE == 'true')",
    );
    const releaseBlock = extractBlockAfter(
      deploy,
      "if (env.IS_PREBUILT_RELEASE == 'true')",
      finalRelease,
    );
    const trap = releaseBlock.indexOf('trap restore_prebuilt_api_zero EXIT');
    const firstReadback = releaseBlock.indexOf(
      'Prebuilt API deployment was not applied at zero replicas.',
    );

    expect(overlayExitTrap).toBeGreaterThanOrEqual(0);
    expect(overlayExitTrap).toBeLessThan(overlayApply);
    expect(overlaySignalTrap).toBeGreaterThanOrEqual(0);
    expect(overlaySignalTrap).toBeLessThan(overlayExitTrap);
    expect(trap).toBeGreaterThanOrEqual(0);
    expect(trap).toBeLessThan(firstReadback);
  });

  it.each(['exit', 'term'] as const)(
    'executes zero-replica compensation when manifest apply fails by %s',
    (failureMode) => {
      const deploy = extractStage('K8s Deploy');
      const { result, trace } = runPrebuiltApplyFailure(deploy, failureMode);
      const apply = trace.findIndex((line) =>
        line.includes('apply -f rendered.yaml'),
      );
      const scaleZero = trace.findIndex((line) =>
        line.includes('scale deployment/api --replicas=0'),
      );

      expect(result.status).not.toBe(0);
      expect(apply).toBeGreaterThanOrEqual(0);
      expect(scaleZero).toBeGreaterThan(apply);
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

  it('keeps the normal manifest and set-image deployment path', () => {
    const deploy = extractStage('K8s Deploy');

    expect(deploy).toContain(
      'kubectl ${kubeConfigArg} apply -f ${shellQuote(manifestFile)}',
    );
    expect(deploy).toContain(
      'set image ${shellQuote("deployment/${deploymentName}")}',
    );
    expect(deploy).toContain(
      "params.BUILD_DOCKER_IMAGE || env.IS_PREBUILT_RELEASE == 'true'",
    );
  });
});
