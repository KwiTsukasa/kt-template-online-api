# NapCatQQ 上游同步与运行时发布流水线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 NapCatQQ 上游 release 审计、Codex CLI 辅助审查、KT 派生运行时镜像构建、API 显式参数推广全部收敛到可验证的 ktWorkflow 自动化链路。

**Architecture:** `mcp/ktWorkflow` 作为自动化控制面，负责确定性采集器、提示词、schema 校验、Codex CLI runner、artifact 归档、MCP tools 和 Jenkins/systemd 命令入口。API 仓库只负责运行时镜像构建契约和部署参数消费，Jenkins/NAS 定时器只调用 ktWorkflow，不复制审计算法。

**Tech Stack:** TypeScript ESM、MCP SDK、zod、Node `child_process`、Codex CLI `exec`、Jenkins Pipeline、Docker、K8s、NestJS API runtime config、Jest。

---

## 文件结构

### `D:\MyFiles\KT\mcp\ktWorkflow`

- 新增 `prompts/napcat/upstream-audit.md`：上游 release 风险分类提示词。
- 新增 `prompts/napcat/sync-candidate-review.md`：候选分支审查提示词。
- 新增 `prompts/napcat/runtime-release-readiness.md`：运行时镜像发布就绪审查提示词。
- 新增 `prompts/napcat/remote-dev-handoff.md`：NAS 远程开发交接提示词。
- 新增 `prompts/napcat/schemas/upstream-audit.schema.json`：`codex exec --output-schema` 使用的 JSON Schema。
- 新增 `prompts/napcat/schemas/runtime-release-readiness.schema.json`：运行时发布就绪报告 schema。
- 新增 `src/tools/napcatAutomation.types.ts`：zod schema、输入输出类型、分类和 reason code 常量。
- 新增 `src/tools/napcatAutomation.prompts.ts`：提示词路径解析和读取。
- 新增 `src/tools/napcatAutomation.ts`：确定性采集器、Codex runner、artifact writer、MCP/CLI builder。
- 修改 `src/types.ts`、`src/core/cli.ts`、`src/registerTools.ts`、`src/server.ts`、`src/core/constants.ts`、`src/selfTest.ts`、`package.json`、`README.md`。

### `D:\MyFiles\KT\Node\kt-template-online-api`

- 修改 `scripts/napcat-desktop-cn-stage-build.mjs`：写入 upstream release、base image digest、Jenkins URL 等 marker。
- 修改 `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`：覆盖 marker 与默认镜像契约。
- 新增 `test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts`：覆盖 Jenkins/K8s runtime override。
- 修改 `Jenkinsfile`：增加 `QQBOT_NAPCAT_IMAGE_OVERRIDE` 与 `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE`。
- 修改 `k8s/prod/api.yaml`：保留安全默认值，由 Jenkins 在发布时显式覆盖。
- 修改 `README.md`、`API.md`：记录发布和回滚契约。

### `D:\MyFiles\KT\GitHub\NapCatQQ`

- 新增 `ci/kt-runtime-release.md`：KT 运行时发布清单。
- 本计划不改 NapCat 登录源码；如果上游同步撞到登录 hot zone，另起 NapCatQQ 专项计划。

### `D:\MyFiles\KT`

- 修改 `TASKS.md`：记录实施结果和验证证据。

---

### Task 1：ktWorkflow NapCat 自动化契约

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.types.ts`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\schemas\upstream-audit.schema.json`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\schemas\runtime-release-readiness.schema.json`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1：先写 RED self-test**

覆盖三件事：`manual-review` 分类能被解析、`HOT_ZONE_CHANGED` reason code 存在、`upstreamAuditOutputSchema` 能校验最小输出。

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

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

预期：因为 `napcatAutomation.types.js` 不存在而失败。

- [ ] **Step 3：实现类型与 zod schema**

实现 `safe-candidate`、`manual-review`、`blocked` 三类分类，以及 `NO_UPSTREAM_CHANGE`、`HOT_ZONE_CHANGED`、`FORK_PATCH_OVERLAP`、`DRY_MERGE_CONFLICT`、`BUILD_GRAPH_CHANGED`、`METADATA_UNAVAILABLE`、`CODEX_SCHEMA_INVALID` 七个 reason code。新增函数必须写 JSDoc，参数说明要解释来源和约束。

- [ ] **Step 4：写 Codex CLI JSON Schema**

`upstream-audit.schema.json` 必须要求 `classification`、`reasonCodes`、`recommendedAction`、`summary`，并禁止额外字段；`runtime-release-readiness.schema.json` 必须要求 `sourceValidation`、`imageValidation`、`apiPromotionReadiness`、`onlineSmokeReadiness`、`rollbackPointer`。

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add prompts/napcat src/tools/napcatAutomation.types.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 定义NapCat自动化审计契约"
```

---

### Task 2：ktWorkflow 提示词包与安全读取器

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\upstream-audit.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\sync-candidate-review.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\runtime-release-readiness.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\prompts\napcat\remote-dev-handoff.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.prompts.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1：先写 RED self-test**

self-test 遍历所有提示词，要求每个 prompt 都包含安全边界：

```md
Do not edit files.
Do not run merge, commit, push, deploy, or Docker mutation commands.
Use only the supplied context packet.
Return JSON that matches the requested schema.
```

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

- [ ] **Step 3：实现 prompt loader**

`loadNapcatAutomationPrompt(name)` 只允许读取 `prompts/napcat/${name}.md` 中的固定 prompt 名称，不能接受任意路径。函数必须有 JSDoc，说明 `name` 来自稳定枚举，不是用户文件路径。

- [ ] **Step 4：写四份提示词**

四份 prompt 分别服务：

- `upstream-audit.md`：只基于 context packet 做 release 风险分类。
- `sync-candidate-review.md`：审查示例候选分支 `kt/sync/v4.8.0`，重点看登录态、二维码、WebUI auth、captcha/new-device。
- `runtime-release-readiness.md`：拆开源码验证、镜像验证、API 推广、线上 smoke、回滚点。
- `remote-dev-handoff.md`：输出 NAS 远程开发交接，不让 Codex 自动改代码。

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add prompts/napcat src/tools/napcatAutomation.prompts.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NapCat自动化提示词包"
```

---

### Task 3：确定性上游审计采集器

**Files:**
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.types.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1：先写 hot-zone RED self-test**

构造上游和 KT patch 同时命中 `packages/napcat-core/login/runtime.ts` 的输入，要求分类为 `manual-review`，reasonCodes 包含 `HOT_ZONE_CHANGED`。

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

- [ ] **Step 3：实现 hot-zone 分类器**

分类规则：

- dry merge 冲突 -> `blocked` + `DRY_MERGE_CONFLICT`
- 上游命中登录/二维码/WebUI/auth/OneBot/build hot zone -> `manual-review`
- 上游文件与 KT fork patch 文件重叠 -> `manual-review`
- 无 hot-zone、无重叠、无冲突 -> `safe-candidate`

- [ ] **Step 4：生成只读审计命令**

`buildNapcatUpstreamAudit(execute=false)` 只能生成只读命令：`git fetch`、`git diff --name-only`、`git merge-tree`、`git range-diff`。不能包含 `git merge`、`git push`、`docker build`、`kubectl`。

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/tools/napcatAutomation.ts src/tools/napcatAutomation.types.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NapCat上游审计采集器"
```

---

### Task 4：Codex CLI Runner 与 Artifact 捕获

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1：先写 Codex 命令安全 RED self-test**

测试 `buildNapcatCodexExecCommand()` 必须包含 `--ask-for-approval never`、`--json`、`--ephemeral`、`--output-schema`，且不能包含 `git push`、`kubectl`、`docker build`。

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

- [ ] **Step 3：实现 Codex 命令封装**

命令固定走 NAS 形态：

```bash
CODEX_HOME=/vol1/docker/kt-codex/home/.codex \
codex exec \
  --cd /vol1/docker/kt-codex/workspace/KT \
  --profile automation \
  --sandbox workspace-write \
  --ask-for-approval never \
  --json \
  --ephemeral \
  --output-schema /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow/prompts/napcat/schemas/upstream-audit.schema.json \
  --output-last-message "$ARTIFACT_DIR/codex-upstream-audit.md" \
  - < "$CONTEXT_PACKET"
```

- [ ] **Step 4：实现 execute 模式**

`execute=true && useCodex=true` 时写入 context packet，运行 Codex，捕获 JSONL，校验 zod schema。schema 失败时返回 `blocked` + `CODEX_SCHEMA_INVALID`，并保留原始输出 artifact。

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add src/tools/napcatAutomation.ts src/selfTest.ts
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 封装NapCat Codex审计执行器"
```

---

### Task 5：MCP Tools 与 CLI Scripts

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\types.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\cli.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\registerTools.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\server.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\core\constants.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\package.json`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`

- [ ] **Step 1：先写注册和 CLI parser RED self-test**

要求 `registeredToolNames` 包含 `kt_napcat_upstream_audit`，`parseNapcatUpstreamAuditCliArgs()` 能解析 `--execute`、`--use-codex`、`--artifact-root`。

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

- [ ] **Step 3：注册五个 MCP tools**

- `kt_napcat_upstream_audit`
- `kt_napcat_sync_candidate_review`
- `kt_napcat_runtime_release_readiness`
- `kt_napcat_remote_dev_handoff`
- `kt_nas_codex_bootstrap_plan`

所有 input schema 都要有默认值，且 `execute` 默认 `false`。

- [ ] **Step 4：增加 package scripts**

```json
{
  "napcat-upstream-audit": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-upstream-audit",
  "napcat-sync-candidate-review": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-sync-candidate-review",
  "napcat-runtime-release-readiness": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --napcat-runtime-release-readiness",
  "nas-codex-bootstrap": "node --import ./node_modules/tsx/dist/loader.mjs src/server.ts --nas-codex-bootstrap"
}
```

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run napcat-upstream-audit -- --artifact-root .kt-workspace/test-artifacts/napcat-upstream-sync
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add package.json README.md src
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 接入NapCat自动化MCP工具和CLI"
```

---

### Task 6：NAS Codex Bootstrap 工具

**Files:**
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\tools\napcatAutomation.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\src\selfTest.ts`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`

- [ ] **Step 1：先写 Linux 路径 RED self-test**

测试 dry-run 输出必须包含 `/vol1/docker/kt-codex/home/.codex`，且不能包含 `C:\Users`。

- [ ] **Step 2：确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
```

- [ ] **Step 3：实现 dry-run**

dry-run 只输出检查命令：

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

- [ ] **Step 4：实现 execute 模式**

`execute=true` 可以创建目录和安装运行环境，但不能 push、merge、deploy，也不能改业务仓库。敏感 Codex auth 只允许可信直连同步，不进入 Git、Jenkins artifact、Docker context 或日志。

- [ ] **Step 5：确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run nas-codex-bootstrap -- --dry-run
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run self-test
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run typecheck
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add README.md src
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "feat: 增加NAS Codex环境引导工具"
```

---

### Task 7：API 运行时 Artifact 元数据

**Files:**
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\scripts\napcat-desktop-cn-stage-build.mjs`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-desktop-cn-image.spec.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`

- [ ] **Step 1：先写 marker RED test**

`napcat-desktop-cn-image.spec.ts` 要断言 stage-build 脚本包含：

```ts
expect(script).toContain('upstreamReleaseTag');
expect(script).toContain('upstreamReleaseCommit');
expect(script).toContain('napcatBaseImageDigest');
expect(script).toContain('jenkinsBuildUrl');
```

- [ ] **Step 2：确认 RED**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

- [ ] **Step 3：扩展 stage-build 参数和 marker**

新增参数：

- `--upstream-release-tag`
- `--upstream-release-commit`
- `--napcat-base-image-digest`
- `--jenkins-build-url`

写入 `fork-artifact.json`，和现有 `forkCommit`、`distSha256`、`napcatMjsSha256` 一起归档。

- [ ] **Step 4：同步 README/API**

文档必须写清楚：API 仓库不提交 `NapCat.Shell.zip`，生产镜像必须来自带完整 marker 的 staged context，base image 必须是 digest。

- [ ] **Step 5：确认 GREEN**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add scripts/napcat-desktop-cn-stage-build.mjs test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts README.md API.md
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 扩展NapCat运行时构建元数据"
```

---

### Task 8：API Jenkins 运行时推广 Override

**Files:**
- Create: `D:\MyFiles\KT\Node\kt-template-online-api\test\modules\qqbot\napcat\napcat-runtime-promotion.spec.ts`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\Jenkinsfile`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\k8s\prod\api.yaml`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\README.md`
- Modify: `D:\MyFiles\KT\Node\kt-template-online-api\API.md`

- [ ] **Step 1：先写 Jenkins/K8s RED test**

测试 Jenkinsfile 必须有两个参数：

- `QQBOT_NAPCAT_IMAGE_OVERRIDE`
- `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE`

并且 K8s deploy 阶段必须通过 `kubectl set env` 注入 `QQBOT_NAPCAT_IMAGE` 和 `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION`。

- [ ] **Step 2：确认 RED**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts --runTestsByPath --runInBand
```

- [ ] **Step 3：增加 Jenkins 参数**

两个参数默认空字符串。为空时继续使用 manifest 默认值；非空时才覆盖运行时 env。

- [ ] **Step 4：K8s deploy 阶段注入 env**

在 `kubectl set image` 之后执行：

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

- [ ] **Step 5：确认 GREEN**

```powershell
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api exec jest test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
```

- [ ] **Step 6：提交**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add Jenkinsfile k8s/prod/api.yaml README.md API.md test/modules/qqbot/napcat/napcat-runtime-promotion.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 支持NapCat运行时镜像参数推广"
```

---

### Task 9：NapCatQQ 发布清单与 Jenkins 入口模板

**Files:**
- Create: `D:\MyFiles\KT\GitHub\NapCatQQ\ci\kt-runtime-release.md`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins\KT-NapCatQQ-Upstream-Sync.Jenkinsfile`
- Create: `D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins\KT-NapCatQQ-Runtime-Release.Jenkinsfile`
- Modify: `D:\MyFiles\KT\mcp\ktWorkflow\README.md`

- [ ] **Step 1：写 NapCatQQ 发布清单**

清单必须包含：origin 指向 KT 可写 fork/mirror、upstream 指向 `https://github.com/NapNeko/NapCatQQ.git`、运行 `pnpm install --frozen-lockfile`、聚焦登录测试、typecheck、build:webui/build:shell/build:framework、Docker 构建只走 ktWorkflow/Jenkins、不自动合并上游。

- [ ] **Step 2：写上游审计 Jenkins 模板**

模板只调用：

```groovy
sh '''
  set -e
  pnpm --dir /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow run napcat-upstream-audit -- \
    --execute \
    --use-codex \
    --artifact-root /vol1/docker/kt-codex/artifacts/napcat-upstream-sync
'''
```

- [ ] **Step 3：写运行时发布 Jenkins 模板**

模板调用 ktWorkflow readiness 和 API promotion 命令，不内联审计算法，不自动 merge，不自动 push。

- [ ] **Step 4：验证模板**

```powershell
rg -n "napcat-upstream-audit|napcat-runtime-release-readiness|git merge|git push" D:\MyFiles\KT\mcp\ktWorkflow\ci\jenkins
git -C D:\MyFiles\KT\mcp\ktWorkflow diff --check
git -C D:\MyFiles\KT\GitHub\NapCatQQ diff --check
```

预期：能看到 ktWorkflow 调用，看不到自动 `git merge` 或 `git push`。

- [ ] **Step 5：提交**

```powershell
git -C D:\MyFiles\KT\mcp\ktWorkflow add README.md ci/jenkins
git -C D:\MyFiles\KT\mcp\ktWorkflow commit -m "docs: 增加NapCatQQ自动化Jenkins入口"
git -C D:\MyFiles\KT\GitHub\NapCatQQ add ci/kt-runtime-release.md
git -C D:\MyFiles\KT\GitHub\NapCatQQ commit -m "docs: 增加KT运行时发布清单"
```

---

### Task 10：本地验证、审查和计划收口

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1：跑本地验证**

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

- [ ] **Step 2：跑 KT global-review**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --content-scan-mode changed --max-findings-per-project 20
```

预期：`findings=[]`；如果是工具误报，修 ktWorkflow review 规则后复跑。

- [ ] **Step 3：更新 TASKS**

记录范围、关键词、验证证据：

```md
### 2026-06-24：NapCatQQ 上游同步与运行时发布流水线实施

- 范围：mcp/ktWorkflow、Node/kt-template-online-api、GitHub/NapCatQQ。
- 关键词：ktWorkflow NapCat 自动化、Codex CLI exec、上游 release 审计、NAS bootstrap、API runtime image/profile override。
- 验证：self-test/typecheck/Jest/global-review/diff-check 通过；线上 Jenkins/NAS dry-run 等待下一阶段。
```

- [ ] **Step 4：清理历史产物预览**

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

如果 `deleted` 非空，执行 `--execute` 后复跑 dry-run，直到 `deleted=[]`。

- [ ] **Step 5：提交 TASKS**

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录NapCatQQ自动化实施结果"
```

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-06-24-napcatqq-upstream-sync-runtime-release-pipeline-implementation-plan.zh-CN.md`。

两种执行方式：

1. **Subagent-Driven（推荐）**：每个 task 派一个新 subagent，父线程逐 task review，ktWorkflow/API/NapCatQQ 分仓提交。
2. **Inline Execution**：本线程用 `superpowers:executing-plans` 批次执行，每个仓库边界做 review checkpoint。

推荐选 **1**。这条线跨三个仓库和两个运行环境，用 task 级 subagent 更容易守住边界。
