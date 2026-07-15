# NapCatQQ Upstream Sync Runtime Release Pipeline Implementation Plan

> **Execution note:** Execute this plan task-by-task with the KT-local workflow and use the checkboxes to track plan state.

**Goal:** Build a ktWorkflow-owned automation path that audits upstream NapCatQQ releases, assists review with Codex CLI, builds verified KT NapCat runtime images, and promotes them to API through explicit deployment parameters.

**Architecture:** `mcp/ktWorkflow` owns collectors, prompts, schema validation, CLI wrappers, MCP tools, and scheduler entry points. `Node/kt-template-online-api` remains the runtime image and API deployment contract owner. Jenkins and NAS timers only call ktWorkflow scripts and never duplicate the audit algorithm.

**Tech Stack:** TypeScript ESM, MCP SDK, zod, Node `child_process`, Codex CLI `exec`, Jenkins Pipeline, Docker, K8s, NestJS API runtime config, Jest.

---

## File Structure

### `D:\MyFiles\KT\mcp\ktWorkflow`

- Create `prompts/napcat/upstream-audit.md`: Codex CLI prompt for upstream release risk classification.
- Create `prompts/napcat/sync-candidate-review.md`: Codex CLI prompt for candidate branch review.
- Create `prompts/napcat/runtime-release-readiness.md`: Codex CLI prompt for image promotion readiness.
- Create `prompts/napcat/remote-dev-handoff.md`: Codex CLI prompt for NAS remote-development handoff.
- Create `prompts/napcat/schemas/upstream-audit.schema.json`: JSON Schema used by `codex exec --output-schema`.
- Create `prompts/napcat/schemas/runtime-release-readiness.schema.json`: JSON Schema for release readiness reports.
- Create `src/tools/napcatAutomation.types.ts`: zod schemas, normalized input types, artifact result types, and constants.
- Create `src/tools/napcatAutomation.prompts.ts`: prompt path resolution and prompt loading helpers.
- Create `src/tools/napcatAutomation.ts`: deterministic collectors, Codex runner, artifact writer, and public builders for tools/scripts.
- Modify `src/types.ts`: exported MCP input/result interfaces.
- Modify `src/core/cli.ts`: CLI parsers for NapCat automation scripts.
- Modify `src/registerTools.ts`: MCP tool registration.
- Modify `src/server.ts`: CLI flag dispatch.
- Modify `src/core/constants.ts`: `registeredToolNames`.
- Modify `src/selfTest.ts`: deterministic self-tests for CLI parser, audit classification, prompt/schema presence, and safe command generation.
- Modify `package.json`: scripts `napcat-upstream-audit`, `napcat-sync-candidate-review`, `napcat-runtime-release-readiness`, and `nas-codex-bootstrap`.
- Modify `README.md`: public ktWorkflow usage docs and NAS command examples.

### `D:\MyFiles\KT\Node\kt-template-online-api`

- Modify `scripts/napcat-desktop-cn-stage-build.mjs`: include upstream release tag/commit, base image digest, Jenkins build URL, and fork artifact metadata.
- Modify `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`: assert richer marker and API deployment override contract.
- Create `test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts`: static tests for Jenkins/K8s runtime image/profile override behavior.
- Modify `Jenkinsfile`: add optional `QQBOT_NAPCAT_IMAGE_OVERRIDE` and `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE` parameters and set K8s env during deploy.
- Modify `k8s/prod/api.yaml`: keep safe defaults while allowing Jenkins `kubectl set env` override.
- Modify `README.md` and `API.md`: document runtime promotion and rollback contract.

### `D:\MyFiles\KT\GitHub\NapCatQQ`

- Create `ci/kt-runtime-release.md`: repo-local release checklist used by Jenkins and human operators.
- No source login behavior changes are part of this plan. If upstream sync reveals login conflicts, create a separate NapCatQQ implementation plan.

### `D:\MyFiles\KT`

- Modify `TASKS.md`: record the completed planning state and verification evidence.

---

### Task 1: ktWorkflow NapCat Automation Contracts

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.types.ts`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\schemas\upstream-audit.schema.json`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\schemas\runtime-release-readiness.schema.json`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Write the failing self-test**

Add a self-test block that imports the new schemas and verifies reason-code normalization.

```ts
import {
  napcatAutomationReasonCodes,
  parseNapcatAutomationClassification,
  upstreamAuditOutputSchema,
} from './tools/napcatAutomation.types.js';

const napcatAuditSchemaSmoke = upstreamAuditOutputSchema.safeParse({
  classification: 'manual-review',
  reasonCodes: ['HOT_ZONE_CHANGED'],
  recommendedAction: 'request-human-review',
  summary: 'Login hot-zone changed.',
});
if (!napcatAuditSchemaSmoke.success) {
  throw new Error('NapCat upstream audit schema self-check failed');
}
if (!napcatAutomationReasonCodes.includes('HOT_ZONE_CHANGED')) {
  throw new Error('NapCat reason-code list self-check failed');
}
if (parseNapcatAutomationClassification('manual-review') !== 'manual-review') {
  throw new Error('NapCat classification parser self-check failed');
}
```

- [ ] **Step 2: Run the self-test and confirm RED**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because `napcatAutomation.types.js` does not exist.

- [ ] **Step 3: Add zod types and constants**

Create `src/tools/napcatAutomation.types.ts`:

```ts
import { z } from 'zod';

export const napcatAutomationClassifications = [
  'safe-candidate',
  'manual-review',
  'blocked',
] as const;

export const napcatAutomationReasonCodes = [
  'NO_UPSTREAM_CHANGE',
  'HOT_ZONE_CHANGED',
  'FORK_PATCH_OVERLAP',
  'DRY_MERGE_CONFLICT',
  'BUILD_GRAPH_CHANGED',
  'METADATA_UNAVAILABLE',
  'CODEX_SCHEMA_INVALID',
] as const;

export const upstreamAuditOutputSchema = z.object({
  classification: z.enum(napcatAutomationClassifications),
  reasonCodes: z.array(z.enum(napcatAutomationReasonCodes)).min(1),
  recommendedAction: z.enum([
    'no-op',
    'create-candidate-branch',
    'request-human-review',
    'block',
  ]),
  summary: z.string().min(1),
});

export type NapcatAutomationClassification =
  (typeof napcatAutomationClassifications)[number];

export interface NapcatUpstreamAuditInput {
  artifactRoot?: string;
  createCandidateBranch?: boolean;
  execute?: boolean;
  forkBranch?: string;
  forkRepo?: string;
  lastAcceptedUpstreamBase?: string;
  upstreamReleaseTag?: string;
  upstreamRepo?: string;
  useCodex?: boolean;
}

export interface NapcatAutomationArtifact {
  path: string;
  type: 'context' | 'json' | 'jsonl' | 'markdown' | 'script';
}

export interface NapcatAutomationResult {
  artifacts: NapcatAutomationArtifact[];
  classification: NapcatAutomationClassification;
  execute: boolean;
  recommendedAction: string;
  summary: string;
}

/**
 * Parses the upstream audit classification emitted by deterministic collectors or Codex.
 * @param value - Raw classification value from JSON output.
 * @returns A supported classification value.
 */
export function parseNapcatAutomationClassification(
  value: string,
): NapcatAutomationClassification {
  const parsed = z.enum(napcatAutomationClassifications).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unsupported NapCat audit classification: ${value}`);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Add JSON schemas for Codex CLI**

Create `prompts/napcat/schemas/upstream-audit.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["classification", "reasonCodes", "recommendedAction", "summary"],
  "properties": {
    "classification": {
      "enum": ["safe-candidate", "manual-review", "blocked"]
    },
    "reasonCodes": {
      "type": "array",
      "minItems": 1,
      "items": {
        "enum": [
          "NO_UPSTREAM_CHANGE",
          "HOT_ZONE_CHANGED",
          "FORK_PATCH_OVERLAP",
          "DRY_MERGE_CONFLICT",
          "BUILD_GRAPH_CHANGED",
          "METADATA_UNAVAILABLE",
          "CODEX_SCHEMA_INVALID"
        ]
      }
    },
    "recommendedAction": {
      "enum": ["no-op", "create-candidate-branch", "request-human-review", "block"]
    },
    "summary": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

Create `prompts/napcat/schemas/runtime-release-readiness.schema.json` with `sourceValidation`, `imageValidation`, `apiPromotionReadiness`, `onlineSmokeReadiness`, and `rollbackPointer` string fields.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add prompts/napcat src/tools/napcatAutomation.types.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 定义NapCat自动化审计契约"
```

---

### Task 2: ktWorkflow Prompt Pack and Safe Prompt Loader

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\upstream-audit.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\sync-candidate-review.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\runtime-release-readiness.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\remote-dev-handoff.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.prompts.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Write the failing self-test**

```ts
import {
  loadNapcatAutomationPrompt,
  napcatAutomationPromptNames,
} from './tools/napcatAutomation.prompts.js';

for (const promptName of napcatAutomationPromptNames) {
  const promptText = loadNapcatAutomationPrompt(promptName);
  if (!promptText.includes('Do not edit files')) {
    throw new Error(`NapCat prompt safety contract missing: ${promptName}`);
  }
}
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because prompt loader does not exist.

- [ ] **Step 3: Create prompt loader**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const napcatAutomationPromptNames = [
  'upstream-audit',
  'sync-candidate-review',
  'runtime-release-readiness',
  'remote-dev-handoff',
] as const;

export type NapcatAutomationPromptName =
  (typeof napcatAutomationPromptNames)[number];

const promptsRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'prompts',
  'napcat',
);

/**
 * Loads a source-controlled NapCat automation prompt by stable prompt name.
 * @param name - Prompt identifier that maps to `prompts/napcat/${name}.md`.
 * @returns UTF-8 prompt text used by Codex CLI automation.
 */
export function loadNapcatAutomationPrompt(
  name: NapcatAutomationPromptName,
): string {
  return readFileSync(path.join(promptsRoot, `${name}.md`), 'utf8');
}
```

- [ ] **Step 4: Create prompts**

Each prompt must include these exact safety lines:

```md
Do not edit files.
Do not run merge, commit, push, deploy, or Docker mutation commands.
Use only the supplied context packet.
Return JSON that matches the requested schema.
```

`upstream-audit.md` must also include the three classifications and the seven reason codes from Task 1.

- [ ] **Step 5: Run GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add prompts/napcat src/tools/napcatAutomation.prompts.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NapCat自动化提示词包"
```

---

### Task 3: Deterministic Upstream Audit Collector

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.types.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Write RED self-test for hot-zone classification**

```ts
import { classifyNapcatUpstreamAudit } from './tools/napcatAutomation.js';

const hotZoneAudit = classifyNapcatUpstreamAudit({
  dryMergeConflict: false,
  forkPatchFiles: ['packages/napcat-core/login/runtime.ts'],
  upstreamChangedFiles: ['packages/napcat-core/login/runtime.ts'],
});
if (hotZoneAudit.classification !== 'manual-review') {
  throw new Error('NapCat hot-zone audit classification self-check failed');
}
if (!hotZoneAudit.reasonCodes.includes('HOT_ZONE_CHANGED')) {
  throw new Error('NapCat hot-zone reason-code self-check failed');
}
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because `classifyNapcatUpstreamAudit` does not exist.

- [ ] **Step 3: Implement classifier and context packet builder**

Add this public classifier:

```ts
const hotZonePatterns = [
  /^packages\/napcat-core\/.*login/i,
  /^packages\/napcat-core\/.*qrcode/i,
  /^packages\/napcat-shell\//i,
  /^packages\/napcat-framework\//i,
  /^packages\/napcat-webui-backend\/.*QQLogin/i,
  /^packages\/napcat-webui-backend\/.*Data/i,
  /^packages\/napcat-webui-backend\/.*auth/i,
  /^packages\/napcat-webui-frontend\//i,
  /^packages\/napcat-adapter\//i,
  /^packages\/napcat-onebot\//i,
  /^packages\/napcat-vite\//i,
  /^package\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^tsconfig.*\.json$/i,
  /^vite.*\.ts$/i,
];

export interface NapcatAuditClassificationInput {
  dryMergeConflict: boolean;
  forkPatchFiles: string[];
  upstreamChangedFiles: string[];
}

/**
 * Classifies upstream release risk from already-collected file-level facts.
 * @param input - Changed files, fork patch files, and dry-merge conflict status.
 * @returns Schema-compatible classification used before optional Codex review.
 */
export function classifyNapcatUpstreamAudit(
  input: NapcatAuditClassificationInput,
): {
  classification: NapcatAutomationClassification;
  reasonCodes: string[];
  recommendedAction: string;
  summary: string;
} {
  const upstream = new Set(input.upstreamChangedFiles);
  const overlapFiles = input.forkPatchFiles.filter((file) => upstream.has(file));
  const hotZoneFiles = input.upstreamChangedFiles.filter((file) =>
    hotZonePatterns.some((pattern) => pattern.test(file)),
  );
  if (input.dryMergeConflict) {
    return {
      classification: 'blocked',
      reasonCodes: ['DRY_MERGE_CONFLICT'],
      recommendedAction: 'block',
      summary: 'Dry merge reported conflicts.',
    };
  }
  if (hotZoneFiles.length > 0 || overlapFiles.length > 0) {
    return {
      classification: 'manual-review',
      reasonCodes: [
        ...(hotZoneFiles.length > 0 ? ['HOT_ZONE_CHANGED'] : []),
        ...(overlapFiles.length > 0 ? ['FORK_PATCH_OVERLAP'] : []),
      ],
      recommendedAction: 'request-human-review',
      summary: 'Upstream changes require manual review before sync.',
    };
  }
  return {
    classification: 'safe-candidate',
    reasonCodes: ['NO_UPSTREAM_CHANGE'],
    recommendedAction: 'create-candidate-branch',
    summary: 'No hot-zone or fork patch overlap was detected.',
  };
}
```

- [ ] **Step 4: Add command builders without executing mutations**

Implement `buildNapcatUpstreamAudit(input)` so `execute=false` returns a script containing only bounded read-only commands:

```bash
git fetch upstream --tags --prune
git fetch origin --prune
git diff --name-only "$LAST_ACCEPTED_UPSTREAM_BASE..$UPSTREAM_RELEASE_COMMIT"
git merge-tree "$FORK_BRANCH" "$UPSTREAM_RELEASE_COMMIT"
```

Do not include `git merge`, `git push`, `docker build`, or `kubectl`.

- [ ] **Step 5: Run GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/tools/napcatAutomation.ts src/tools/napcatAutomation.types.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NapCat上游审计采集器"
```

---

### Task 4: Codex CLI Runner and Artifact Capture

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Write RED self-test for safe Codex command**

```ts
import { buildNapcatCodexExecCommand } from './tools/napcatAutomation.js';

const codexCommand = buildNapcatCodexExecCommand({
  artifactRoot: '/vol1/docker/kt-codex/artifacts/smoke',
  contextPacketPath: '/vol1/docker/kt-codex/artifacts/smoke/context-packet.md',
  outputSchemaPath: '/vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow/prompts/napcat/schemas/upstream-audit.schema.json',
  promptName: 'upstream-audit',
  workspaceRoot: '/vol1/docker/kt-codex/workspace/KT',
});
if (!codexCommand.includes('--ask-for-approval never')) {
  throw new Error('NapCat Codex runner approval policy self-check failed');
}
if (codexCommand.includes('git push') || codexCommand.includes('kubectl')) {
  throw new Error('NapCat Codex runner mutation guard self-check failed');
}
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because `buildNapcatCodexExecCommand` does not exist.

- [ ] **Step 3: Implement command builder**

The command builder must shell-quote every path and include:

```bash
CODEX_HOME=/vol1/docker/kt-codex/home/.codex
codex exec
--cd /vol1/docker/kt-codex/workspace/KT
--profile automation
--sandbox workspace-write
--ask-for-approval never
--json
--ephemeral
--output-schema /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow/prompts/napcat/schemas/upstream-audit.schema.json
--output-last-message /vol1/docker/kt-codex/artifacts/smoke/codex-upstream-audit.md
```

- [ ] **Step 4: Implement execution mode**

When `execute=true` and `useCodex=true`, `buildNapcatUpstreamAudit` must:

1. Write a context packet under the artifact root.
2. Run Codex CLI with a timeout of 10 minutes.
3. Capture JSONL stdout to `codex-upstream-audit.jsonl`.
4. Parse the final JSON payload with `upstreamAuditOutputSchema`.
5. Return `classification='blocked'` with `CODEX_SCHEMA_INVALID` if parsing fails.

- [ ] **Step 5: Run GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/tools/napcatAutomation.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 封装NapCat Codex审计执行器"
```

---

### Task 5: MCP Tools and CLI Scripts

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\types.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\cli.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\registerTools.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\server.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\constants.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\package.json`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1: Write RED self-test for tool registration and CLI parser**

```ts
import { parseNapcatUpstreamAuditCliArgs } from './core/cli.js';
import { registeredToolNames } from './core/constants.js';

const napcatCli = parseNapcatUpstreamAuditCliArgs([
  'node',
  'server',
  '--napcat-upstream-audit',
  '--execute',
  '--use-codex',
  '--artifact-root',
  '/vol1/docker/kt-codex/artifacts/napcat-upstream-sync',
]);
if (!napcatCli.execute || !napcatCli.useCodex) {
  throw new Error('NapCat upstream audit CLI parser self-check failed');
}
if (!registeredToolNames.includes('kt_napcat_upstream_audit')) {
  throw new Error('NapCat MCP tool registry self-check failed');
}
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because parser and tool names do not exist.

- [ ] **Step 3: Register MCP tools**

Add tools:

```ts
server.registerTool(
  'kt_napcat_upstream_audit',
  {
    description: 'Generate or execute a NapCatQQ upstream release audit through ktWorkflow.',
    inputSchema: {
      artifactRoot: z.string().optional(),
      createCandidateBranch: z.boolean().default(false),
      execute: z.boolean().default(false),
      forkBranch: z.string().default('kt/runtime-maintenance'),
      forkRepo: z.string().default('D:/MyFiles/KT/GitHub/NapCatQQ'),
      lastAcceptedUpstreamBase: z.string().optional(),
      upstreamReleaseTag: z.string().optional(),
      upstreamRepo: z.string().default('NapNeko/NapCatQQ'),
      useCodex: z.boolean().default(false),
    },
    title: 'KT NapCat Upstream Audit',
  },
  async (input) => response(await buildNapcatUpstreamAudit(input)),
);
```

Also register `kt_napcat_sync_candidate_review`, `kt_napcat_runtime_release_readiness`, `kt_napcat_remote_dev_handoff`, and `kt_nas_codex_bootstrap_plan`.

- [ ] **Step 4: Add CLI flags and package scripts**

`package.json` scripts:

```json
{
  "napcat-upstream-audit": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-upstream-audit",
  "napcat-sync-candidate-review": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-sync-candidate-review",
  "napcat-runtime-release-readiness": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-runtime-release-readiness",
  "nas-codex-bootstrap": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --nas-codex-bootstrap"
}
```

- [ ] **Step 5: Run GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run napcat-upstream-audit -- --artifact-root .kt-workspace/test-artifacts/napcat-upstream-sync
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: dry-run prints commands/artifacts, self-test/typecheck pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add package.json README.md src
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 接入NapCat自动化MCP工具和CLI"
```

---

### Task 6: NAS Codex Bootstrap Plan Tool

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`

- [ ] **Step 1: Write RED self-test for Linux-only bootstrap commands**

```ts
import { buildNasCodexBootstrapPlan } from './tools/napcatAutomation.js';

const bootstrap = buildNasCodexBootstrapPlan({ execute: false });
const commandText = bootstrap.commands.map((item) => item.command).join('\n');
if (!commandText.includes('/vol1/docker/kt-codex/home/.codex')) {
  throw new Error('NAS Codex bootstrap CODEX_HOME self-check failed');
}
if (commandText.includes('C:\\Users')) {
  throw new Error('NAS Codex bootstrap Windows path guard self-check failed');
}
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

Expected: fails because bootstrap builder does not exist.

- [ ] **Step 3: Implement dry-run bootstrap**

The dry-run must emit a bounded SSH here-string command that checks:

```bash
node --version
corepack --version
pnpm --version
git --version
docker --version
codex --version
test -d /vol1/docker/kt-codex/workspace/KT
test -d /vol1/docker/kt-codex/home/.codex
```

It must not copy secrets in dry-run mode.

- [ ] **Step 4: Add execute mode with explicit safe operations**

`execute=true` may create directories and install packages, but must not push, merge, deploy, or edit business repos.

- [ ] **Step 5: Run GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run nas-codex-bootstrap -- --dry-run
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

Expected: dry-run prints NAS setup checks, self-test/typecheck pass.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add README.md src
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NAS Codex环境引导工具"
```

---

### Task 7: API Runtime Artifact Metadata

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\napcat-desktop-cn-stage-build.mjs`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-desktop-cn-image.spec.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`

- [ ] **Step 1: Write RED test for richer fork artifact marker**

Add assertions:

```ts
expect(script).toContain('upstreamReleaseTag');
expect(script).toContain('upstreamReleaseCommit');
expect(script).toContain('napcatBaseImageDigest');
expect(script).toContain('jenkinsBuildUrl');
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

Expected: fails because the stage-build script only writes the older marker fields.

- [ ] **Step 3: Extend CLI args and marker**

Add `readArg` calls and marker fields:

```js
const upstreamReleaseTag = readArg('upstream-release-tag', 'unknown');
const upstreamReleaseCommit = readArg('upstream-release-commit', upstreamBaseCommit);
const napcatBaseImageDigest = readArg('napcat-base-image-digest', '');
const jenkinsBuildUrl = readArg('jenkins-build-url', '');

const marker = {
  builtAt: new Date().toISOString(),
  distSha256: sha256Directory(shellDist),
  forkCommit: gitCommit(napcatRoot),
  jenkinsBuildUrl,
  napcatBaseImageDigest,
  napcatMjsSha256: sha256File(napcatMjs),
  upstreamBaseCommit,
  upstreamReleaseCommit,
  upstreamReleaseTag,
};
```

- [ ] **Step 4: Document command shape**

Add docs showing:

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --upstream-release-tag v4.8.0 `
  --upstream-release-commit 0000000000000000000000000000000000000000 `
  --napcat-base-image-digest mlikiowa/napcat-docker@sha256:0000000000000000000000000000000000000000000000000000000000000000 `
  --jenkins-build-url https://jenkins.kwitsukasa.top/job/KT-NapCatQQ-Runtime-Release/1/
```

- [ ] **Step 5: Run GREEN**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

Expected: tests/typecheck pass and diff has no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add scripts/napcat-desktop-cn-stage-build.mjs test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts README.md API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 扩展NapCat运行时构建元数据"
```

---

### Task 8: API Jenkins Runtime Promotion Override

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-runtime-promotion.spec.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\Jenkinsfile`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\k8s\prod\api.yaml`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`

- [ ] **Step 1: Write RED static test**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../..');
const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('NapCat runtime promotion contract', () => {
  it('exposes Jenkins parameters for runtime image and profile overrides', () => {
    const jenkinsfile = readSource('Jenkinsfile');
    expect(jenkinsfile).toContain("string(name: 'QQBOT_NAPCAT_IMAGE_OVERRIDE'");
    expect(jenkinsfile).toContain("string(name: 'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE'");
    expect(jenkinsfile).toContain('kubectl ${kubeConfigArg} ${namespaceArg} set env');
    expect(jenkinsfile).toContain('QQBOT_NAPCAT_IMAGE=${napcatImageOverride}');
    expect(jenkinsfile).toContain('QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=${napcatProfileOverride}');
  });

  it('keeps a safe default runtime profile in the K8s manifest', () => {
    const manifest = readSource('k8s/prod/api.yaml');
    expect(manifest).toContain('value: kt-napcat-desktop-cn:desktop-cn-v10');
    expect(manifest).toContain('value: desktop-cn-v10');
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts --runTestsByPath --runInBand
```

Expected: fails because Jenkins parameters do not exist.

- [ ] **Step 3: Add Jenkins parameters**

Add:

```groovy
string(name: 'QQBOT_NAPCAT_IMAGE_OVERRIDE', defaultValue: '', description: 'Verified NapCat runtime image to inject into API deployment; empty keeps manifest/default env')
string(name: 'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE', defaultValue: '', description: 'Verified NapCat runtime profile version to inject into API deployment; empty keeps manifest/default env')
```

- [ ] **Step 4: Set K8s env only when override is present**

Inside `K8s Deploy`, after `set image`, add:

```groovy
def napcatImageOverride = params.QQBOT_NAPCAT_IMAGE_OVERRIDE?.trim()
def napcatProfileOverride = params.QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE?.trim()
if (napcatImageOverride) {
  runCmd("kubectl ${kubeConfigArg} ${namespaceArg} set env ${shellQuote("deployment/${deploymentName}")} ${shellQuote("QQBOT_NAPCAT_IMAGE=${napcatImageOverride}")}")
}
if (napcatProfileOverride) {
  runCmd("kubectl ${kubeConfigArg} ${namespaceArg} set env ${shellQuote("deployment/${deploymentName}")} ${shellQuote("QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=${napcatProfileOverride}")}")
}
```

- [ ] **Step 5: Run GREEN**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

Expected: tests/typecheck pass and diff has no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add Jenkinsfile k8s/prod/api.yaml README.md API.md test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 支持NapCat运行时镜像参数推广"
```

---

### Task 9: NapCatQQ Release Checklist and Jenkins Entry Templates

**Files:**
- Create: `D:\MyFiles\KT\GitHub\NapCatQQ\ci\kt-runtime-release.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins\KT-NapCatQQ-Upstream-Sync.Jenkinsfile`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins\KT-NapCatQQ-Runtime-Release.Jenkinsfile`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`

- [ ] **Step 1: Create release checklist**

The checklist must include:

```md
# KT NapCat Runtime Release Checklist

- Verify `origin` points to the KT writable fork or mirror.
- Verify `upstream` points to `https://github.com/NapNeko/NapCatQQ.git`.
- Run `pnpm install --frozen-lockfile`.
- Run focused login/runtime tests.
- Run `pnpm run typecheck`.
- Run `pnpm run build:webui`, `pnpm run build:shell`, and `pnpm run build:framework`.
- Build Docker runtime only through ktWorkflow/Jenkins.
- Do not merge upstream release branches without human review.
```

- [ ] **Step 2: Add upstream sync Jenkins template**

The upstream sync Jenkinsfile must call only:

```groovy
sh '''
  set -e
  pnpm --dir /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow run napcat-upstream-audit -- \
    --execute \
    --use-codex \
    --artifact-root /vol1/docker/kt-codex/artifacts/napcat-upstream-sync
'''
```

- [ ] **Step 3: Add runtime release Jenkins template**

The runtime release Jenkinsfile must call ktWorkflow readiness and API promotion commands, and must not inline the audit algorithm.

- [ ] **Step 4: Verify templates**

Run:

```powershell
rg -n "napcat-upstream-audit|napcat-runtime-release-readiness|git merge|git push" D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins
git -C D:\MyFiles\KT\mcp\ktWorkflow diff --check
git -C D:\MyFiles\KT\GitHub\NapCatQQ diff --check
```

Expected: templates contain ktWorkflow calls and do not contain automatic `git merge` or `git push`.

- [ ] **Step 5: Commit**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add README.md ci/jenkins
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "docs: 增加NapCatQQ自动化Jenkins入口"
git -C D:\MyFiles\KT\GitHub\NapCatQQ add ci/kt-runtime-release.md
git -C D:\MyFiles\KT\GitHub\NapCatQQ commit -m "docs: 增加KT运行时发布清单"
```

---

### Task 10: Local Verification, Review, and Planning Closeout

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Run local verification**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run napcat-upstream-audit -- --artifact-root .kt-workspace/test-artifacts/napcat-upstream-sync
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run nas-codex-bootstrap -- --dry-run
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
git -C D:\MyFiles\KT\mcp\ktWorkflow diff --check
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
git -C D:\MyFiles\KT\GitHub\NapCatQQ diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Run KT global review**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --content-scan-mode changed --max-findings-per-project 20
```

Expected: `findings=[]` or only documented false positives fixed in ktWorkflow review rules.

- [ ] **Step 3: Update TASKS**

Record scope, keywords, and verification evidence for:

```md
### 2026-06-24：NapCatQQ 上游同步与运行时发布流水线实施

- 范围：mcp/ktWorkflow、Node/kt-template-online-api、GitHub/NapCatQQ。
- 关键词：ktWorkflow NapCat 自动化、Codex CLI exec、上游 release 审计、NAS bootstrap、API runtime image/profile override。
- 验证：self-test/typecheck/Jest/global-review/diff-check 通过；线上 Jenkins/NAS dry-run 等待下一阶段。
```

- [ ] **Step 4: Run cleanup preview**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected: report is reviewed. If it lists stale generated artifacts, run `--execute` and then rerun dry-run until `deleted=[]`.

- [ ] **Step 5: Commit remaining docs**

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录NapCatQQ自动化实施结果"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-06-24-napcatqq-upstream-sync-runtime-release-pipeline-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, and keep ktWorkflow/API/NapCatQQ commits independent.
2. **Inline Execution** - Execute tasks in this session using `KT local execution`, with review checkpoints after each repository boundary.

Recommended choice: **1**. This work touches three repositories and two runtime environments, so task-level subagents plus parent review will keep scope cleaner.
