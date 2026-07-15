# API Deployment Observation Foundation Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Build Phase 2 of the approved API Runtime Foundation: a ktWorkflow deployment observation adapter that gathers Jenkins, K8s, Pod, `/health/runtime`, and task smoke evidence before any deployed feature is called complete.

**Architecture:** Keep API runtime health as the source contract and implement the observation workflow in `mcp/ktWorkflow`. The new tool generates a bounded, read-only NAS script by default, can execute it only when `execute=true`, normalizes command output into an API-compatible runtime evidence summary, and writes evidence under `.kt-workspace/test-artifacts/deploy-observation`. Deployment rollout evidence remains separate from functional smoke evidence.

**Tech Stack:** TypeScript ESM, `@modelcontextprotocol/sdk`, Zod, Node `child_process`, PowerShell, `ssh nas`, Kubernetes `kubectl`, Jenkins home/log read-only inspection, `curl`, pnpm.

---

## Current Context

- API repo: `D:\MyFiles\KT\Node\kt-template-online-api`, branch `dev`, currently clean at the time this plan was written.
- ktWorkflow repo: `D:\MyFiles\KT\mcp\ktWorkflow`, branch `main`, currently has pre-existing changes in `README.md`, `src/selfTest.ts`, and `src/tools/review.ts`.
- Do not create a `.worktree`. The user explicitly prefers a normal development branch.
- Do not overwrite the dirty ktWorkflow files. The execution phase must classify or preserve those changes before editing files that overlap this plan.
- API public health contract is already implemented as plain JSON:

```ts
export type RuntimeHealthStatus = 'live' | 'ready' | 'degraded' | 'blocked';

export interface RuntimeHealthCheck {
  name: string;
  status: RuntimeHealthStatus;
  critical: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface RuntimeHealthReport {
  service: 'kt-template-online-api';
  checkedAt: string;
  status: RuntimeHealthStatus;
  checks: RuntimeHealthCheck[];
}
```

## File Structure

- Create `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\deployObservation.ts`
  - Builds the read-only NAS observation command.
  - Parses marked command sections from stdout.
  - Normalizes Jenkins, Deployment, Pod, runtime health, and smoke data into evidence.
  - Writes JSON evidence under `.kt-workspace/test-artifacts/deploy-observation`.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\types.ts`
  - Add `DeployObservationInput`, evidence DTOs, and assertion types.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\core\cli.ts`
  - Add `parseDeployObservationCliArgs(argv)`.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\registerTools.ts`
  - Register MCP tool `kt_deploy_observation`.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\server.ts`
  - Add `--deploy-observation` CLI branch.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\core\constants.ts`
  - Add `kt_deploy_observation` to `registeredToolNames`.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\closeout.ts`
  - Point `deploy-observation` upgrade target to the new tool file.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`
  - Add self-tests for CLI parsing, stdout section parsing, evidence normalization, and dry-run command generation.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\package.json`
  - Add `deploy-observation` script.

- Modify `D:\MyFiles\KT\mcp\ktWorkflow\README.md`
  - Document the new MCP tool and CLI.

- Modify `D:\MyFiles\KT\TASKS.md`
  - Record Phase 2 implementation and verification evidence after code is complete.

## Task 0: Protect Branch And Existing Changes

**Files:**
- Read: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`
- Read: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`
- Read: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\review.ts`

- [ ] **Step 1: Confirm repo states**

Run:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
git -C D:\MyFiles\KT\mcp\ktWorkflow status --short --branch
git -C D:\MyFiles\KT status --short --branch
```

Expected:

```text
API repo is on dev and clean.
ktWorkflow repo shows existing modified README.md, src/selfTest.ts, src/tools/review.ts.
Root repo may be dirty from unrelated workspace records.
```

- [ ] **Step 2: Inspect overlapping ktWorkflow changes**

Run:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow diff -- README.md src/selfTest.ts src/tools/review.ts
```

Expected:

```text
The diff is read before edits. Existing hunks are preserved or deliberately carried into the development branch.
```

- [ ] **Step 3: Use a normal development branch**

Run:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow branch --show-current
git -C D:\MyFiles\KT\mcp\ktWorkflow switch -c dev
```

Expected if `dev` does not exist:

```text
Switched to a new branch 'dev'
```

Expected if `dev` already exists:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow switch dev
```

```text
Switched to branch 'dev'
```

- [ ] **Step 4: Stop if switching would overwrite files**

If Git refuses the branch switch because local changes would be overwritten, stop execution and report the exact file list. Do not run `git reset`, `git checkout --`, or any destructive cleanup without explicit user approval.

## Task 1: Add Failing Self-Tests For Deploy Observation

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Add imports that should fail before implementation**

Modify the import area in `src/selfTest.ts`:

```ts
import {
  parseDeployObservationCliArgs,
  parseGlobalReviewCliArgs,
  parseWorkstreamCloseoutCliArgs,
} from "./core/cli.js";
import {
  buildDeployObservation,
  buildDeployObservationSectionMap,
  normalizeDeployObservationEvidence,
} from "./tools/deployObservation.js";
```

- [ ] **Step 2: Add the deploy observation self-test block**

Add this block after the existing workstream closeout self-tests and before the final test artifact write:

```ts
  const deployObservationInput = parseDeployObservationCliArgs([
    "node",
    "server",
    "--deploy-observation",
    "--project",
    "api",
    "--job",
    "kt-template-online-api",
    "--build",
    "132",
    "--commit",
    "abc1234",
    "--image-tag",
    "abc1234",
    "--namespace",
    "kt-prod",
    "--deployment",
    "kt-template-online-api",
    "--container",
    "api",
    "--health-url",
    "http://127.0.0.1:48085/health/runtime",
    "--smoke",
    "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime",
  ]);
  if (
    deployObservationInput.project !== "api" ||
    deployObservationInput.jobName !== "kt-template-online-api" ||
    deployObservationInput.buildNumber !== "132" ||
    deployObservationInput.expectedCommit !== "abc1234" ||
    deployObservationInput.imageTag !== "abc1234" ||
    deployObservationInput.namespace !== "kt-prod" ||
    deployObservationInput.deployment !== "kt-template-online-api" ||
    deployObservationInput.container !== "api" ||
    deployObservationInput.healthUrl !==
      "http://127.0.0.1:48085/health/runtime" ||
    deployObservationInput.smoke !==
      "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime" ||
    deployObservationInput.execute !== false
  ) {
    throw new Error("deploy observation CLI parser self-check failed");
  }

  const deployObservationSections = buildDeployObservationSectionMap(
    [
      "__KT_SECTION:jenkins_meta__",
      "buildNumber=132",
      "result=SUCCESS",
      "__KT_SECTION:jenkins_log_tail__",
      "Checking out Revision abc1234",
      "Finished: SUCCESS",
      "__KT_SECTION:deployment_json__",
      JSON.stringify({
        metadata: { generation: 12 },
        spec: {
          template: {
            spec: {
              containers: [
                {
                  image:
                    "k3d-kt-registry.localhost:5000/kt-template-online-api:abc1234",
                  name: "api",
                },
              ],
            },
          },
        },
        status: {
          observedGeneration: 12,
          readyReplicas: 1,
          updatedReplicas: 1,
        },
      }),
      "__KT_SECTION:pods_json__",
      JSON.stringify({
        items: [
          {
            metadata: {
              name: "kt-template-online-api-abc",
            },
            spec: {
              containers: [
                {
                  image:
                    "k3d-kt-registry.localhost:5000/kt-template-online-api:abc1234",
                  name: "api",
                },
              ],
            },
            status: {
              containerStatuses: [
                {
                  image:
                    "k3d-kt-registry.localhost:5000/kt-template-online-api:abc1234",
                  name: "api",
                  ready: true,
                  restartCount: 0,
                },
              ],
              phase: "Running",
              startTime: "2026-06-14T00:00:00Z",
            },
          },
        ],
      }),
      "__KT_SECTION:health_json__",
      JSON.stringify({
        checkedAt: "2026-06-14T00:00:01.000Z",
        checks: [
          {
            critical: true,
            message: "NestJS process answered runtime health request",
            name: "process",
            status: "live",
          },
        ],
        service: "kt-template-online-api",
        status: "ready",
      }),
      "__KT_SECTION:smoke_text__",
      "{\"service\":\"kt-template-online-api\",\"status\":\"ready\"}",
    ].join("\n"),
  );
  const deployObservationEvidence = normalizeDeployObservationEvidence({
    checkedAt: new Date("2026-06-14T00:00:02.000Z"),
    input: deployObservationInput,
    sectionMap: deployObservationSections,
  });
  if (
    deployObservationEvidence.status !== "passed" ||
    deployObservationEvidence.details.deployment.image !==
      "k3d-kt-registry.localhost:5000/kt-template-online-api:abc1234" ||
    deployObservationEvidence.details.deployment.observedGeneration !== 12 ||
    deployObservationEvidence.details.pod.name !==
      "kt-template-online-api-abc" ||
    deployObservationEvidence.details.pod.restartCount !== 0 ||
    deployObservationEvidence.details.runtimeHealth.status !== "ready" ||
    !deployObservationEvidence.assertions.every((item) => item.passed)
  ) {
    throw new Error("deploy observation evidence normalization self-check failed");
  }

  const deployObservationDryRun = await buildDeployObservation({
    deployment: "kt-template-online-api",
    execute: false,
    healthUrl: "http://127.0.0.1:48085/health/runtime",
    imageTag: "abc1234",
    jobName: "kt-template-online-api",
    namespace: "kt-prod",
    project: "api",
    smoke: "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime",
  });
  const deployObservationCommandText = JSON.stringify(
    deployObservationDryRun.commands,
  );
  if (
    deployObservationDryRun.execute !== false ||
    !deployObservationCommandText.includes("tr -d '\\015' | bash -s") ||
    !deployObservationCommandText.includes("kubectl") ||
    !deployObservationCommandText.includes("/health/runtime") ||
    deployObservationDryRun.evidence
  ) {
    throw new Error("deploy observation dry-run self-check failed");
  }
```

- [ ] **Step 3: Run self-test and confirm the expected failure**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected:

```text
FAIL: Cannot find module './tools/deployObservation.js' or exported member parseDeployObservationCliArgs.
```

- [ ] **Step 4: Commit the red test only if the team wants TDD commits**

Run only when working branch policy allows red commits:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "test: 覆盖部署观测工作流"
```

Expected:

```text
Commit is created on dev, or the red test remains staged for the green implementation commit.
```

## Task 2: Add Deploy Observation Types

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\types.ts`

- [ ] **Step 1: Add deploy observation status and input types**

Insert after `RemoteHealthCheckInput`:

```ts
export type DeployObservationStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface DeployObservationInput {
  artifactRoot?: string;
  buildNumber?: string;
  container?: string;
  deployment?: string;
  execute?: boolean;
  expectedCommit?: string;
  healthUrl?: string;
  imageTag?: string;
  jobName?: string;
  jenkinsHome?: string;
  kubeconfigPath?: string;
  namespace?: string;
  project?: string;
  selector?: string;
  smoke?: string;
  sshPort?: number;
  sshTarget?: string;
}
```

- [ ] **Step 2: Add evidence DTOs**

Insert after `DeployObservationInput`:

```ts
export interface DeployObservationAssertion {
  critical: boolean;
  message: string;
  name: string;
  passed: boolean;
}

export interface DeployObservationCommand {
  command: string;
  name: string;
}

export interface DeployObservationJenkinsEvidence {
  buildNumber: string | null;
  commitMatched: boolean | null;
  expectedCommit: string | null;
  finishedStatus: string | null;
  jobName: string;
}

export interface DeployObservationDeploymentEvidence {
  container: string;
  containerFound: boolean;
  desiredReplicas: number | null;
  generation: number | null;
  image: string | null;
  namespace: string;
  observedGeneration: number | null;
  readyReplicas: number | null;
  updatedReplicas: number | null;
}

export interface DeployObservationPodEvidence {
  containerFound: boolean;
  image: string | null;
  name: string | null;
  phase: string | null;
  ready: boolean | null;
  restartCount: number | null;
}

export interface DeployObservationRuntimeHealthEvidence {
  checkCount: number | null;
  service: string | null;
  status: string | null;
}

export interface DeployObservationEvidence {
  assertions: DeployObservationAssertion[];
  details: {
    deployment: DeployObservationDeploymentEvidence;
    eventsTail: string;
    jenkins: DeployObservationJenkinsEvidence;
    pod: DeployObservationPodEvidence;
    runtimeHealth: DeployObservationRuntimeHealthEvidence;
    smoke: {
      command: string | null;
      output: string;
    };
  };
  endedAt: string;
  environment: 'production';
  operation: 'kt_deploy_observation';
  project: string;
  schemaVersion: 1;
  startedAt: string;
  status: DeployObservationStatus;
  target: string;
  taskType: 'deploy';
  title: string;
}

export interface DeployObservationResult {
  artifactPath?: string;
  commands: DeployObservationCommand[];
  evidence?: DeployObservationEvidence;
  execute: boolean;
  notes: string[];
  requiredEvidence: string[];
  result?: ExecResult;
}
```

- [ ] **Step 3: Run typecheck and confirm the expected failure**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected:

```text
FAIL because deployObservation.ts and parseDeployObservationCliArgs are not implemented yet.
```

## Task 3: Implement The Deploy Observation Tool

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\deployObservation.ts`

- [ ] **Step 1: Create the tool file**

Create `src/tools/deployObservation.ts` with this implementation:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  DeployObservationAssertion,
  DeployObservationCommand,
  DeployObservationDeploymentEvidence,
  DeployObservationEvidence,
  DeployObservationInput,
  DeployObservationJenkinsEvidence,
  DeployObservationPodEvidence,
  DeployObservationResult,
  DeployObservationRuntimeHealthEvidence,
  DeployObservationStatus,
} from '../types.js';
import { tryPowerShell } from '../core/exec.js';
import {
  formatDateInShanghai,
  resolveInsideRoot,
  workspaceRoot,
} from '../core/workspace.js';

interface NormalizedInput extends Required<
  Pick<
    DeployObservationInput,
    | 'artifactRoot'
    | 'container'
    | 'deployment'
    | 'healthUrl'
    | 'jenkinsHome'
    | 'jobName'
    | 'kubeconfigPath'
    | 'namespace'
    | 'project'
    | 'selector'
    | 'sshPort'
    | 'sshTarget'
  >
> {
  buildNumber?: string;
  execute: boolean;
  expectedCommit?: string;
  imageTag?: string;
  smoke?: string;
}

interface NormalizeEvidenceInput {
  checkedAt?: Date;
  input: DeployObservationInput;
  sectionMap: Map<string, string>;
}

function normalizeInput(input: DeployObservationInput = {}): NormalizedInput {
  return {
    artifactRoot:
      input.artifactRoot || '.kt-workspace/test-artifacts/deploy-observation',
    buildNumber: input.buildNumber?.trim() || undefined,
    container: input.container?.trim() || 'api',
    deployment: input.deployment?.trim() || 'kt-template-online-api',
    execute: input.execute === true,
    expectedCommit: input.expectedCommit?.trim() || undefined,
    healthUrl:
      input.healthUrl?.trim() ||
      'http://127.0.0.1:48085/health/runtime',
    imageTag: input.imageTag?.trim() || undefined,
    jenkinsHome: input.jenkinsHome?.trim() || '/vol1/docker/jenkins/jenkins_home',
    jobName: input.jobName?.trim() || 'KT-Template/KT-Template-API/main',
    kubeconfigPath:
      input.kubeconfigPath?.trim() ||
      '/vol1/docker/kt-k8s/kubeconfig/kt-nas.jenkins.yaml',
    namespace: input.namespace?.trim() || 'kt-prod',
    project: input.project?.trim() || 'api',
    selector:
      input.selector?.trim() || 'app=kt-template-online-api',
    smoke: input.smoke?.trim() || undefined,
    sshPort: input.sshPort || 2202,
    sshTarget: input.sshTarget?.trim() || 'nas',
  };
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getPath(source: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function getArray(source: unknown, keys: string[]): unknown[] {
  const value = getPath(source, keys);
  return Array.isArray(value) ? value : [];
}

function buildRemoteScript(input: NormalizedInput): string {
  const smokeBlock = input.smoke
    ? [
        "section smoke_text",
        `${input.smoke} 2>&1 || true`,
      ].join('\n')
    : [
        "section smoke_text",
        "echo 'no task smoke command provided'",
      ].join('\n');

  return [
    'set -u',
    'section() { printf "\\n__KT_SECTION:%s__\\n" "$1"; }',
    `JOB_NAME=${shellSingleQuote(input.jobName)}`,
    `BUILD_NUMBER=${shellSingleQuote(input.buildNumber || '')}`,
    `JENKINS_HOME=${shellSingleQuote(input.jenkinsHome)}`,
    `KUBECONFIG_PATH=${shellSingleQuote(input.kubeconfigPath)}`,
    `NAMESPACE=${shellSingleQuote(input.namespace)}`,
    `DEPLOYMENT=${shellSingleQuote(input.deployment)}`,
    `SELECTOR=${shellSingleQuote(input.selector)}`,
    `HEALTH_URL=${shellSingleQuote(input.healthUrl)}`,
    'JOB_DIR="$JENKINS_HOME/jobs/$JOB_NAME/builds"',
    'if [ -z "$BUILD_NUMBER" ] && [ -d "$JOB_DIR" ]; then BUILD_NUMBER="$(find "$JOB_DIR" -maxdepth 1 -type d -printf "%f\\n" 2>/dev/null | grep -E "^[0-9]+$" | sort -n | tail -1 || true)"; fi',
    'BUILD_DIR="$JOB_DIR/$BUILD_NUMBER"',
    'section jenkins_meta',
    'printf "jobName=%s\\n" "$JOB_NAME"',
    'printf "buildNumber=%s\\n" "$BUILD_NUMBER"',
    'if [ -f "$BUILD_DIR/build.xml" ]; then grep -E "<result>|<number>|<SHA1>" "$BUILD_DIR/build.xml" | tail -20 || true; fi',
    'section jenkins_log_tail',
    'if [ -f "$BUILD_DIR/log" ]; then tail -160 "$BUILD_DIR/log" || true; else echo "jenkins log not found"; fi',
    'section deployment_json',
    'kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o json 2>/dev/null || true',
    'section pods_json',
    'kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$NAMESPACE" get pods -l "$SELECTOR" -o json 2>/dev/null || true',
    'section events_tail',
    'kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$NAMESPACE" get events --sort-by=.lastTimestamp 2>/dev/null | tail -80 || true',
    'section health_json',
    'curl -fsS --max-time 8 "$HEALTH_URL" 2>/dev/null || true',
    smokeBlock,
  ].join('\n');
}

function buildPowerShellCommand(input: NormalizedInput): string {
  const remoteScript = buildRemoteScript(input);
  return [
    `$remoteScript = @'`,
    remoteScript,
    `'@`,
    `$remoteScript | ssh -p ${input.sshPort} ${input.sshTarget} "tr -d '\\015' | bash -s"`,
  ].join('\n');
}

export function buildDeployObservationCommands(
  input: DeployObservationInput = {},
): DeployObservationCommand[] {
  const normalized = normalizeInput(input);
  return [
    {
      command: buildPowerShellCommand(normalized),
      name: 'nas-deploy-observation',
    },
  ];
}

export function buildDeployObservationSectionMap(stdout: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentName: string | null = null;
  let currentLines: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const marker = line.match(/^__KT_SECTION:([a-z0-9_-]+)__$/i);
    if (marker) {
      if (currentName) sections.set(currentName, currentLines.join('\n').trim());
      currentName = marker[1];
      currentLines = [];
    } else if (currentName) {
      currentLines.push(line);
    }
  }

  if (currentName) sections.set(currentName, currentLines.join('\n').trim());
  return sections;
}

function normalizeJenkinsEvidence(
  input: NormalizedInput,
  sectionMap: Map<string, string>,
): DeployObservationJenkinsEvidence {
  const meta = sectionMap.get('jenkins_meta') || '';
  const log = sectionMap.get('jenkins_log_tail') || '';
  const buildNumber =
    input.buildNumber ||
    meta.match(/^buildNumber=(.+)$/m)?.[1]?.trim() ||
    null;
  const finishedStatus =
    log.match(/Finished:\s*([A-Z]+)/)?.[1] ||
    meta.match(/<result>([^<]+)<\/result>/)?.[1] ||
    null;
  const expectedCommit = input.expectedCommit || null;

  return {
    buildNumber,
    commitMatched: expectedCommit
      ? `${meta}\n${log}`.includes(expectedCommit)
      : null,
    expectedCommit,
    finishedStatus,
    jobName: input.jobName,
  };
}

function normalizeDeploymentEvidence(
  input: NormalizedInput,
  sectionMap: Map<string, string>,
): DeployObservationDeploymentEvidence {
  const deployment = parseJsonObject(sectionMap.get('deployment_json') || '');
  const containers = getArray(deployment, [
    'spec',
    'template',
    'spec',
    'containers',
  ]);
  const container = containers.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).name === input.container,
  ) as Record<string, unknown> | undefined;

  return {
    container: input.container,
    generation: numberOrNull(getPath(deployment, ['metadata', 'generation'])),
    image: stringOrNull(container?.image),
    namespace: input.namespace,
    observedGeneration: numberOrNull(
      getPath(deployment, ['status', 'observedGeneration']),
    ),
    readyReplicas: numberOrNull(getPath(deployment, ['status', 'readyReplicas'])),
    updatedReplicas: numberOrNull(
      getPath(deployment, ['status', 'updatedReplicas']),
    ),
  };
}

function normalizePodEvidence(
  input: NormalizedInput,
  sectionMap: Map<string, string>,
): DeployObservationPodEvidence {
  const pods = parseJsonObject(sectionMap.get('pods_json') || '');
  const items = getArray(pods, ['items']);
  const normalizedPods = items.map((item) => {
    const pod = item as Record<string, unknown>;
    const statuses = getArray(pod, ['status', 'containerStatuses']);
    const status = statuses.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        (candidate as Record<string, unknown>).name === input.container,
    ) as Record<string, unknown> | undefined;
    return {
      image: stringOrNull(status?.image),
      name: stringOrNull(getPath(pod, ['metadata', 'name'])),
      phase: stringOrNull(getPath(pod, ['status', 'phase'])),
      ready: typeof status?.ready === 'boolean' ? status.ready : null,
      restartCount: numberOrNull(status?.restartCount),
    };
  });

  return (
    normalizedPods.find(
      (pod) =>
        pod.phase === 'Running' &&
        (!input.imageTag || pod.image?.includes(input.imageTag)),
    ) ||
    normalizedPods.find((pod) => pod.phase === 'Running') ||
    normalizedPods[0] || {
      image: null,
      name: null,
      phase: null,
      ready: null,
      restartCount: null,
    }
  );
}

function normalizeRuntimeHealthEvidence(
  sectionMap: Map<string, string>,
): DeployObservationRuntimeHealthEvidence {
  const health = parseJsonObject(sectionMap.get('health_json') || '');
  const checks = Array.isArray(health?.checks) ? health.checks : null;

  return {
    checkCount: checks ? checks.length : null,
    service: stringOrNull(health?.service),
    status: stringOrNull(health?.status),
  };
}

function buildAssertion(
  name: string,
  passed: boolean,
  message: string,
  critical = true,
): DeployObservationAssertion {
  return {
    critical,
    message,
    name,
    passed,
  };
}

function aggregateStatus(assertions: DeployObservationAssertion[]): DeployObservationStatus {
  if (assertions.some((item) => item.critical && !item.passed)) return 'failed';
  if (assertions.some((item) => !item.critical && !item.passed)) return 'blocked';
  return 'passed';
}

export function normalizeDeployObservationEvidence({
  checkedAt = new Date(),
  input,
  sectionMap,
}: NormalizeEvidenceInput): DeployObservationEvidence {
  const normalized = normalizeInput(input);
  const jenkins = normalizeJenkinsEvidence(normalized, sectionMap);
  const deployment = normalizeDeploymentEvidence(normalized, sectionMap);
  const pod = normalizePodEvidence(normalized, sectionMap);
  const runtimeHealth = normalizeRuntimeHealthEvidence(sectionMap);
  const smokeOutput = sectionMap.get('smoke_text') || '';
  const assertions = [
    buildAssertion(
      'jenkins-finished',
      jenkins.finishedStatus === 'SUCCESS',
      `Jenkins result is ${jenkins.finishedStatus || 'missing'}`,
    ),
    buildAssertion(
      'jenkins-commit',
      jenkins.commitMatched !== false,
      jenkins.expectedCommit
        ? `Expected commit ${jenkins.expectedCommit} was found in Jenkins evidence`
        : 'No expected commit supplied; commit match skipped',
      Boolean(jenkins.expectedCommit),
    ),
    buildAssertion(
      'deployment-observed-generation',
      deployment.generation !== null &&
        deployment.observedGeneration !== null &&
        deployment.observedGeneration >= deployment.generation,
      `Deployment observedGeneration=${deployment.observedGeneration} generation=${deployment.generation}`,
    ),
    buildAssertion(
      'deployment-ready-replicas',
      deployment.updatedReplicas !== null &&
        deployment.readyReplicas !== null &&
        deployment.desiredReplicas !== null &&
        deployment.updatedReplicas >= deployment.desiredReplicas &&
        deployment.readyReplicas >= deployment.desiredReplicas,
      `Deployment desired=${deployment.desiredReplicas} updated=${deployment.updatedReplicas} ready=${deployment.readyReplicas}`,
    ),
    buildAssertion(
      'pod-running-for-image',
      pod.phase === 'Running' &&
        pod.ready === true &&
        (!normalized.imageTag || Boolean(pod.image?.includes(normalized.imageTag))),
      `Pod ${pod.name || 'missing'} phase=${pod.phase || 'missing'} image=${pod.image || 'missing'}`,
    ),
    buildAssertion(
      'pod-restart-count-zero',
      pod.restartCount === 0,
      `Pod restartCount=${pod.restartCount}`,
    ),
    buildAssertion(
      'runtime-health-not-blocked',
      runtimeHealth.service === 'kt-template-online-api' &&
        runtimeHealth.status !== null &&
        runtimeHealth.status !== 'blocked',
      `Runtime health status=${runtimeHealth.status || 'missing'}`,
    ),
    buildAssertion(
      'task-smoke-present',
      Boolean(normalized.smoke && smokeOutput.trim().length > 0),
      normalized.smoke
        ? 'Task smoke command produced output'
        : 'No task smoke command supplied; rollout evidence is not functional evidence',
      Boolean(normalized.smoke),
    ),
  ];

  return {
    assertions,
    details: {
      deployment,
      eventsTail: sectionMap.get('events_tail') || '',
      jenkins,
      pod,
      runtimeHealth,
      smoke: {
        command: normalized.smoke || null,
        output: smokeOutput,
      },
    },
    endedAt: checkedAt.toISOString(),
    environment: 'production',
    operation: 'kt_deploy_observation',
    project: normalized.project,
    schemaVersion: 1,
    startedAt: checkedAt.toISOString(),
    status: aggregateStatus(assertions),
    target: `${normalized.namespace}/${normalized.deployment}`,
    taskType: 'deploy',
    title: 'KT API deployment observation',
  };
}

function writeEvidenceArtifact(
  artifactRoot: string,
  evidence: DeployObservationEvidence,
): string {
  const root = resolveInsideRoot(artifactRoot);
  const directory = path.join(root, formatDateInShanghai());
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(
    directory,
    `${evidence.project}-${Date.now()}-deploy-observation.json`,
  );
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function buildDeployObservation(
  input: DeployObservationInput = {},
): Promise<DeployObservationResult> {
  const normalized = normalizeInput(input);
  const commands = buildDeployObservationCommands(normalized);
  const requiredEvidence = [
    'Jenkins job/build number and final Finished status',
    'Expected commit hash match when a commit is supplied',
    'K8s Deployment generation, observedGeneration, updatedReplicas, readyReplicas',
    'Running Pod selected by current image tag with restartCount',
    'GET /health/runtime response with service/status/check count',
    'Task-specific smoke command output',
  ];
  const notes = [
    'Default execute=false only returns the bounded read-only command.',
    'execute=true runs through ssh nas with CRLF-stripped here-string and writes local JSON evidence.',
    'Jenkins/K8s rollout evidence is deployment evidence; task smoke is still required for functional completion.',
    'The command reads Jenkins build files, kubectl status, events, and HTTP health only; it does not read Secrets or mutate remote state.',
  ];

  if (!normalized.execute) {
    return {
      commands,
      execute: false,
      notes,
      requiredEvidence,
    };
  }

  const command = commands[0]?.command || '';
  const result = await tryPowerShell(command, workspaceRoot, 180_000);
  const sectionMap = buildDeployObservationSectionMap(result.stdout);
  const evidence = normalizeDeployObservationEvidence({
    input: normalized,
    sectionMap,
  });
  const artifactPath = writeEvidenceArtifact(normalized.artifactRoot, evidence);

  return {
    artifactPath,
    commands,
    evidence,
    execute: true,
    notes,
    requiredEvidence,
    result,
  };
}
```

- [ ] **Step 2: Run typecheck and confirm parser/register failures remain**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected:

```text
FAIL only because parseDeployObservationCliArgs and tool registration are not wired yet.
```

## Task 4: Wire CLI And MCP Registration

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\cli.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\registerTools.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\server.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\constants.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\package.json`

- [ ] **Step 1: Add CLI parser**

Modify the type imports in `src/core/cli.ts`:

```ts
import type {
  DeployObservationInput,
  GlobalCodeReviewInput,
  ObsidianContextInput,
  ObsidianSyncInput,
  ObsidianValidateInput,
  WorkstreamCloseoutInput,
  WorkstreamReusablePattern,
} from '../types.js';
```

Append this parser to `src/core/cli.ts`:

```ts
export function parseDeployObservationCliArgs(argv: string[]): DeployObservationInput {
  const sshPort = Number(readOption(argv, ['--ssh-port', '--sshPort']));

  return {
    artifactRoot: readOption(argv, ['--artifact-root', '--artifactRoot']),
    buildNumber: readOption(argv, ['--build', '--build-number', '--buildNumber']),
    container: readOption(argv, ['--container']),
    deployment: readOption(argv, ['--deployment']),
    execute: argv.includes('--execute'),
    expectedCommit: readOption(argv, ['--commit', '--expected-commit', '--expectedCommit']),
    healthUrl: readOption(argv, ['--health-url', '--healthUrl']),
    imageTag: readOption(argv, ['--image-tag', '--imageTag']),
    jenkinsHome: readOption(argv, ['--jenkins-home', '--jenkinsHome']),
    jobName: readOption(argv, ['--job', '--job-name', '--jobName']),
    kubeconfigPath: readOption(argv, ['--kubeconfig', '--kubeconfig-path', '--kubeconfigPath']),
    namespace: readOption(argv, ['--namespace']),
    project: readOption(argv, ['--project']),
    selector: readOption(argv, ['--selector']),
    smoke: readOption(argv, ['--smoke']),
    sshPort: Number.isFinite(sshPort) ? sshPort : undefined,
    sshTarget: readOption(argv, ['--ssh', '--ssh-target', '--sshTarget']),
  };
}
```

- [ ] **Step 2: Register the MCP tool**

Modify imports in `src/registerTools.ts`:

```ts
import { buildDeployObservation } from './tools/deployObservation.js';
```

Add this registration after `kt_remote_health_check`:

```ts
  server.registerTool(
    'kt_deploy_observation',
    {
      description:
        '生成或执行 API 发布后的只读部署观测：Jenkins、K8s Deployment、Pod、/health/runtime 和任务 smoke，并输出运行态证据。',
      inputSchema: {
        artifactRoot: z.string().optional(),
        buildNumber: z.string().optional(),
        container: z.string().default('api'),
        deployment: z.string().default('kt-template-online-api'),
        execute: z.boolean().default(false),
        expectedCommit: z.string().optional(),
        healthUrl: z.string().default('http://127.0.0.1:48085/health/runtime'),
        imageTag: z.string().optional(),
        jenkinsHome: z.string().default('/vol1/docker/jenkins/jenkins_home'),
        jobName: z.string().default('KT-Template/KT-Template-API/main'),
        kubeconfigPath: z
          .string()
          .default('/vol1/docker/kt-k8s/kubeconfig/kt-nas.jenkins.yaml'),
        namespace: z.string().default('kt-prod'),
        project: z.string().default('api'),
        selector: z.string().default('app=kt-template-online-api'),
        smoke: z.string().optional(),
        sshPort: z.number().int().min(1).max(65_535).default(2202),
        sshTarget: z.string().default('nas'),
      },
      title: 'KT Deploy Observation',
    },
    async (input) => response(await buildDeployObservation(input)),
  );
```

- [ ] **Step 3: Add CLI branch**

Modify imports in `src/server.ts`:

```ts
import {
  parseDeployObservationCliArgs,
  parseGlobalReviewCliArgs,
  parseObsidianContextCliArgs,
  parseObsidianCliArgs,
  parseObsidianSyncCliArgs,
  parseWorkstreamCloseoutCliArgs,
} from './core/cli.js';
import { buildDeployObservation } from './tools/deployObservation.js';
```

Add this branch before `--self-test`:

```ts
} else if (process.argv.includes('--deploy-observation')) {
  console.log(
    JSON.stringify(
      await buildDeployObservation(parseDeployObservationCliArgs(process.argv)),
      null,
      2,
    ),
  );
```

- [ ] **Step 4: Add registered tool name**

Add to `registeredToolNames` in `src/core/constants.ts` immediately after `kt_remote_health_check`:

```ts
  'kt_deploy_observation',
```

- [ ] **Step 5: Add package script**

Add to `scripts` in `package.json`:

```json
"deploy-observation": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --deploy-observation"
```

- [ ] **Step 6: Run typecheck and self-test**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected:

```text
typecheck passes.
self-test writes .kt-workspace/test-artifacts/ktWorkflow-self-test.json and exits successfully.
```

- [ ] **Step 7: Commit the tool wiring**

Run:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/tools/deployObservation.ts src/types.ts src/core/cli.ts src/registerTools.ts src/server.ts src/core/constants.ts src/selfTest.ts package.json
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 添加部署观测工作流"
```

Expected:

```text
Commit succeeds on dev and contains only ktWorkflow deploy observation code and tests.
```

## Task 5: Update ktWorkflow Documentation And Closeout Guidance

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\closeout.ts`

- [ ] **Step 1: Update closeout deploy-observation target**

In `src/tools/closeout.ts`, change the `deploy-observation` target to:

```ts
  'deploy-observation': {
    files: ['src/tools/deployObservation.ts', 'src/tools/workflow.ts', 'src/tools/testing.ts', 'README.md'],
    label: '部署观测',
    prompt: '把 Jenkins/K8s build、commit、镜像、Deployment、Pod、/health/runtime、日志和 smoke 观测步骤写成固定计划。',
  },
```

- [ ] **Step 2: Update README capability list**

Add this bullet to the capability list in `README.md`:

```markdown
- 生成或执行部署观测：把 Jenkins build、commit、K8s Deployment、Pod、`/health/runtime` 和任务 smoke 汇总成 `.kt-workspace/test-artifacts/deploy-observation` 下的运行态证据。
```

- [ ] **Step 3: Update README tool table**

Add this row after `kt_remote_health_check`:

```markdown
| `kt_deploy_observation`  | 生成或执行 API 发布后的部署观测，汇总 Jenkins、K8s、Pod、`/health/runtime` 和任务 smoke 证据                 |
```

- [ ] **Step 4: Update README scripts table**

Add this row in the script table:

```markdown
| `pnpm run deploy-observation` | 默认 dry-run 输出只读 NAS 观测命令；传 `--execute` 时执行 Jenkins/K8s/health/smoke 观测并写入 `.kt-workspace/test-artifacts/deploy-observation`。 |
```

- [ ] **Step 5: Add README usage guidance**

Add this guidance near the remote health check note:

```markdown
- API 推送触发 Jenkins/K8s 后先运行 `pnpm run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --namespace kt-prod --deployment kt-template-online-api --container api --health-url http://127.0.0.1:48085/health/runtime --smoke "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime"` 查看 dry-run 命令；确认需要线上只读观测时再加 `--execute`。Deployment/Pod 成功只算发布证据，功能完成还必须看 smoke 输出。
```

- [ ] **Step 6: Run self-test**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected:

```text
self-test passes after closeout guidance change.
```

- [ ] **Step 7: Commit docs and closeout guidance**

Run:

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add README.md src/tools/closeout.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "docs: 补充部署观测工作流说明"
```

Expected:

```text
Commit succeeds on dev with README and closeout guidance only.
```

## Task 6: Validate Dry-Run And Read-Only Observation

**Files:**
- Evidence output: `D:\MyFiles\KT\.kt-workspace\test-artifacts\deploy-observation`

- [ ] **Step 1: Confirm package manager and Node compatibility**

Run:

```powershell
node -v
pnpm -v
Get-Content D:\MyFiles\KT\mcp\ktWorkflow\package.json | Select-String -Pattern '"engines"|"packageManager"'
```

Expected:

```text
Node satisfies >=20.19.0 and pnpm matches or is compatible with pnpm@10.28.2.
```

If Node does not satisfy `engines`, run:

```powershell
nvm ls
nvm use 20.19.0
```

- [ ] **Step 2: Run static validation**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected:

```text
Both commands pass.
```

- [ ] **Step 3: Run deploy observation dry-run**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --namespace kt-prod --deployment kt-template-online-api --container api --health-url http://127.0.0.1:48085/health/runtime --smoke "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime"
```

Expected:

```text
JSON output has execute=false, a nas-deploy-observation command, requiredEvidence, and notes.
No SSH command is executed.
No artifact is written.
```

- [ ] **Step 4: Run read-only online observation**

Run only after confirming NAS SSH is expected to be reachable:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --execute --project api --job KT-Template/KT-Template-API/main --namespace kt-prod --deployment kt-template-online-api --container api --health-url http://127.0.0.1:48085/health/runtime --smoke "curl -fsS --max-time 8 http://127.0.0.1:48085/health/runtime"
```

Expected:

```text
JSON output includes execute=true, result.ok, evidence, and artifactPath.
artifactPath is under D:\MyFiles\KT\.kt-workspace\test-artifacts\deploy-observation.
Evidence contains Jenkins, Deployment, Pod, runtimeHealth, smoke, and assertions.
If Jenkins/K8s/health is unavailable, the evidence status is failed with concrete failing assertions.
```

- [ ] **Step 5: Inspect artifact without leaking noisy payloads**

Run:

```powershell
Get-ChildItem D:\MyFiles\KT\.kt-workspace\test-artifacts\deploy-observation -Recurse -Filter *deploy-observation.json | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Get-Content $_.FullName | ConvertFrom-Json | Select-Object title,status,target,operation,project }
```

Expected:

```text
The latest artifact summary shows operation=kt_deploy_observation and a concrete status.
```

## Task 7: Documentation Sync, Cleanup, Review, And Commits

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Run doc sync plan**

MCP call:

```json
{
  "changedFiles": [
    "mcp/ktWorkflow/src/tools/deployObservation.ts",
    "mcp/ktWorkflow/src/types.ts",
    "mcp/ktWorkflow/src/core/cli.ts",
    "mcp/ktWorkflow/src/registerTools.ts",
    "mcp/ktWorkflow/src/server.ts",
    "mcp/ktWorkflow/src/core/constants.ts",
    "mcp/ktWorkflow/src/selfTest.ts",
    "mcp/ktWorkflow/src/tools/closeout.ts",
    "mcp/ktWorkflow/README.md",
    "mcp/ktWorkflow/package.json"
  ],
  "project": "mcp",
  "taskType": "mcp"
}
```

Expected:

```text
Doc sync identifies README and KT workflow documentation as handled; no API contract doc change is required because /health/runtime contract did not change.
```

If the MCP tool is unavailable in the execution environment, inspect `mcp/ktWorkflow/README.md`, `Node/kt-template-online-api/README.md`, `Node/kt-template-online-api/API.md`, and `docs/obsidian/modules/KT 模块 - API Backend.md` manually, then record the manual doc sync result in closeout evidence.

- [ ] **Step 2: Update TASKS.md**

Add a recent record with this content shape:

```markdown
### 2026-06-14：API Runtime Foundation Phase 2 部署观测

- 范围：mcp/ktWorkflow、Node/kt-template-online-api docs
- 关键词：API Runtime Foundation、DeployObservationAdapter、Jenkins、K8s、/health/runtime、ktWorkflow
- 验证：pnpm --dir mcp/ktWorkflow run typecheck；pnpm --dir mcp/ktWorkflow run self-test；deploy-observation dry-run；deploy-observation --execute 只读观测或明确记录 NAS 不可达阻塞。
```

- [ ] **Step 3: Run cleanup preview**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected:

```text
Output lists deleted=[] or a finite set of stale .kt-workspace artifacts.
```

If stale artifacts are listed, run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --execute
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected:

```text
Final dry-run shows deleted=[].
```

- [ ] **Step 4: Run KT global review**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review
```

Expected:

```text
No Critical or Important findings caused by this change.
Known pre-existing dirty files are classified separately.
```

- [ ] **Step 5: Request KT global review**

Use `KT global review` after implementation and before declaring the work complete. Review must cover:

```text
mcp/ktWorkflow deploy observation command safety
evidence normalization correctness
Jenkins/K8s success not being treated as functional smoke success
dirty ktWorkflow files preserved rather than overwritten
```

Expected:

```text
All Critical and Important findings are fixed or explicitly rejected with evidence before finishing.
```

- [ ] **Step 6: Run closeout audit**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run workstream-closeout -- --title "API Runtime Foundation Phase 2 部署观测" --project mcp --project api --verification "typecheck/self-test/deploy-observation dry-run/read-only observation evidence" --doc-sync "kt_change_doc_sync README handled; API health contract unchanged" --cleanup "cleanup-history final dry-run deleted=[]" --cleanup-final-deleted 0 --review "global-review no Critical/Important findings caused by this change" --problem "无新卡点或已记录 NAS/Jenkins/K8s 只读观测阻塞" --solution "kt_deploy_observation 固化 Jenkins/K8s/health/smoke 观测" --pattern deploy-observation --kt-workflow-updated --upgrade-notes "新增 kt_deploy_observation 工具和 CLI"
```

Expected:

```text
canReportComplete=true.
```

- [ ] **Step 7: Commit root TASKS update if changed**

Run:

```powershell
git -C D:\MyFiles\KT status --short -- TASKS.md
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录API部署观测重构进度"
```

Expected:

```text
Root commit contains only the task record update made for this phase.
```

## Self-Review

- Spec coverage:
  - Jenkins job/build number is covered by `jenkins_meta` and `jenkins_log_tail`.
  - Commit hash is covered by `expectedCommit` and `jenkins-commit` assertion.
  - Image tag is covered by Deployment container image and Pod image match.
  - Deployment `generation`, `observedGeneration`, `updatedReplicas`, and `readyReplicas` are parsed from `deployment_json`.
  - Running Pod and restart count are parsed from `pods_json`.
  - Failing logs/events are included through `jenkins_log_tail` and `events_tail`.
  - `/health/runtime` is fetched as `health_json` and normalized without exposing config topology.
  - Task-specific smoke is separate from rollout evidence through `task-smoke-present`.

- Placeholder scan:
  - This plan contains concrete file paths, code snippets, commands, expected outputs, and commit messages.
  - No step asks the implementer to invent a missing function name or validation command.

- Type consistency:
  - `parseDeployObservationCliArgs`, `buildDeployObservation`, `buildDeployObservationSectionMap`, and `normalizeDeployObservationEvidence` are introduced in early tasks and referenced consistently in later tasks.
  - `DeployObservationInput`, `DeployObservationEvidence`, and `DeployObservationResult` live in `src/types.ts` and are consumed by the new tool and registration.
