# NapCatQQ 上游同步与运行时发布流水线设计

## 背景

KT 现在已经维护了自己的 `NapCatQQ` fork，因为 QQ 登录、二维码刷新、重复登录状态重置、WebUI 登录运行态这些问题必须在源码层修。生产运行时镜像是 KT 派生的中文桌面镜像：

```text
kt-napcat-desktop-cn:<profile>
```

目前发布链路还有一段人工操作：

1. 本地构建 `NapCatQQ` fork。
2. 用 API 仓库脚本 staging `NapCat.Shell` artifact。
3. 在 NAS 上构建 Docker context。
4. 验证镜像。
5. 修改 API 的运行时镜像/profile。
6. 推送 API/Admin 并观察 Jenkins/K8s。

这段人工链路容易漂移。更重要的是，当上游 `NapNeko/NapCatQQ` 发布新的 latest release 时，我们必须知道“哪些上游改动能同步，哪些会撞上 KT fork 的登录/二维码补丁”，不能无脑合并上游。

本设计把 `NapCatQQ` fork 变成独立发布单元，并新增一个上游 release 审计循环。审计循环默认只读，只产报告和候选分支，绝不自动合并到 KT 维护分支。

定时审计不能依赖笔记本。笔记本需要通勤和切换网络，不能作为稳定 scheduler 或 runner。NAS 必须成为常驻执行节点，负责定时检查、release artifact、Docker 镜像构建，以及后续远程 Codex 开发会话。

主要上游元数据来源：

- GitHub latest release REST API：`GET /repos/{owner}/{repo}/releases/latest`。
- GitHub compare REST API：`GET /repos/{owner}/{repo}/compare/{basehead}`。
- 本地 Git 检查：`git diff`、`git range-diff`、`git merge-tree`、文件级 hot zone 扫描。

## 目标

1. 给 `NapCatQQ` 建独立 Jenkins 流水线，负责 fork 验证和运行时镜像发布。
2. 增加定时上游 latest release 审计，发现新 release 但不自动合并。
3. 把上游改动分成：可生成候选、必须人工审查、阻断。
4. 生成可审计报告：上游 delta、KT fork patch、重叠文件、hot zone 命中、推荐动作。
5. 从已确认的 KT fork ref 构建并验证 `kt-napcat-desktop-cn` 镜像。
6. 通过显式参数或发布元数据把已验证镜像推广到 API 部署，不再手工临时改 manifest。
7. 线上完成标准必须包含真实 smoke，不把 Jenkins/K8s 成功当成功能闭环。
8. 在 NAS 上安装并配置常驻 Codex CLI 与 KT 全量 workspace，保证笔记本不在线时仍可远程开发。
9. 上游定时审计必须跑在 NAS 的 Jenkins 或 NAS 服务定时器中，不能跑在笔记本。
10. 把 Codex CLI 自动化编排放进 `mcp/ktWorkflow`，由 ktWorkflow 统一管理提示词模板、schema、context 采集器和 Jenkins/systemd 命令入口。

## 非目标

- 不绕过 QQ/Tencent 验证码、新设备验证或账号安全流程。
- 不自动把 upstream `release-latest` 合并到 KT 维护分支。
- 不向上游 `NapNeko/NapCatQQ` 仓库推送。
- 不把 OneBot 心跳当作 QQ 账号登录成功。
- 不让 API 仓库持有 NapCat 源码补丁。
- 不把 GitHub token、Jenkins 凭证、SSH key、WebUI token、Docker registry 凭证写进 Git。
- 不在没有明确确认时自动迁移线上账号到新运行时镜像。
- 不把同步到 NAS 的 Codex secrets、sessions、logs、SQLite 状态、浏览器状态或 auth 文件写入 Git 或 release artifact。
- 不运行会在无人值守状态下修改代码或合并 upstream 的 Codex agent。
- 不让 Codex CLI 自动化读取实时凭据，除非该提示词任务明确需要。上游 release 审计应只基于 Git 元数据和生成的 context packet。

## 仓库职责

### `D:\MyFiles\KT\GitHub\NapCatQQ`

负责 KT 的 NapCat 源码 fork 和源码级测试。

需要的 remote：

```text
upstream = https://github.com/NapNeko/NapCatQQ.git
origin   = KT 可写 mirror 或 fork 仓库
```

当前本地 `origin` 可能指向上游。实现阶段必须先修正这一点。Jenkins 如果发现 `origin` 指向 `NapNeko/NapCatQQ`，必须拒绝 push。

建议长期分支：

```text
kt/runtime-maintenance
kt/sync/<upstream-release-tag>
kt/release/<runtime-profile>
```

### `D:\MyFiles\KT\Node\kt-template-online-api`

负责：

- `scripts/napcat-desktop-cn-stage-build.mjs`
- `ci/napcat-desktop-cn/Dockerfile`
- `ci/napcat-desktop-cn/verify.sh`
- API 运行时镜像/profile 参数与部署契约
- API 侧登录/SSE 防旧码护栏

API 仓库不提交 `NapCat.Shell.zip` 二进制 artifact。

### Jenkins 与 NAS Docker

负责：

- 定时执行上游 release 审计。
- 执行 NapCat fork 构建、测试和类型检查。
- 在 NAS 本地构建并验证 Docker 镜像。
- 保存运行时发布元数据和部署观测 artifact。

### `D:\MyFiles\KT\mcp\ktWorkflow`

负责自动化控制面。Jenkins 和 NAS 定时器应该调用 ktWorkflow，而不是各自复制一份临时 shell 逻辑。

必备能力：

- 基于 Git/GitHub 事实生成上游审计 context packet。
- 调用 Codex CLI 自动化提示词，并完成 schema 校验和 artifact 捕获。
- 给 Codex Desktop 和 Codex CLI 都提供 MCP tools。
- 给 Jenkins/systemd 提供 npm scripts，例如 `napcat-upstream-audit`、`napcat-sync-candidate-review`、`napcat-runtime-release-readiness`、`nas-codex-bootstrap`。
- 把确定性采集器、提示词模板、schema、输出规范化、artifact 写入统一收口在一个可复用实现里。

API 仓库继续负责运行时 Docker 集成和 API 部署契约，不负责通用自动化 runner。

### NAS Codex Worker 与 KT 全量 Workspace

NAS 必须承载稳定的远程开发和定时审计环境。当前只读探测结果：

```text
host: Tsukasa-NAS
os: Debian GNU/Linux 12 (bookworm), x86_64
available: git 2.43.0, Docker 28.5.2
missing: node, npm, pnpm, corepack, codex
laptop surface: Codex Desktop；本机 CLI wrapper 当前显示 codex-cli 0.131.0
```

推荐常驻目录：

```text
/vol1/docker/kt-codex/
  home/.codex/                 # NAS 的 CODEX_HOME，chmod 700
  workspace/KT/                # KT 全量 workspace checkout
  artifacts/                   # 审计和发布 artifact
  logs/                        # 服务日志，按周期轮转
  jenkins-workspaces/          # Jenkins 干净 job workspace/worktree
```

启用定时任务前，NAS 必须先安装 Node 和 Codex：

1. 安装满足 KT engines 的 Node 版本，目前 `mcp/ktWorkflow` 至少需要 Node `>=20.19.0`。
2. 启用 `corepack`，并按各仓库 `packageManager` 使用对应 `pnpm`。
3. NAS 安装最新稳定版 Codex CLI。笔记本使用的是 Codex Desktop，NAS CLI 不需要和 Desktop wrapper 版本锁死一致。
4. 验证 `node --version`、`corepack --version`、`pnpm --version`、`git --version`、`docker --version`、`codex --version`。

NAS 上的 KT workspace 必须是真实全量 checkout，不是笔记本临时状态复制。实现阶段要创建 workspace manifest，列出每个 KT 子仓库的路径、remote、默认分支和是否允许 push。没有稳定 remote 的仓库必须在首次 bootstrap 前明确列出。`.kt-workspace`、构建输出、日志、session、DB sync 草稿等 ignored runtime 目录不能作为源码真相源同步。

Codex 配置一致指“逻辑一致”，不是把 Windows profile 原样复制到 Linux：

- 同步或生成非敏感配置：KT trusted projects、model 默认值、approval policy、sandbox policy、KT-local skills、自定义 KT skills、`ktWorkflow` MCP。
- 把 `config.toml` 里的 Windows 路径转换成 NAS Linux 路径。
- 本地浏览器、computer-use、Windows Figma local context 这类 GUI-only 能力默认禁用，除非后续安装了 NAS 可用 backend。
- NAS 是完全可信环境，需要时可以从笔记本复制敏感 Codex 文件。同步仍必须走可信直连通道，文件 owner-only 权限，并排除在 Git、Jenkins artifact、Docker build context 和公开日志之外。
- Codex auth 可通过 NAS 上交互式 `codex login` 完成，也可以直接把所需 auth material 同步到 `CODEX_HOME` 并设置 `chmod 600`。
- sessions、logs、SQLite state、browser state、generated images 只有在远程连续性有价值时才复制；它们仍是本地运行态，不是源码或发布 artifact。
- NAS 服务统一使用 `CODEX_HOME=/vol1/docker/kt-codex/home/.codex`，避免定时任务意外写入 root 默认 home。

上游定时审计默认只运行确定性的 shell/Jenkins 逻辑。Codex CLI 安装的目的，是远程开发、人工审查和接管，不是默默无人值守改代码。未来如果需要非交互调用 Codex，也必须在一次性分支/worktree 中运行，产出完整 artifact，并在 commit、push、merge 或 deployment 前要求人工审查。

自动化分工如下：

```text
ktWorkflow 确定性采集器
  -> 包含 git/GitHub/build 事实的 context packet
  -> ktWorkflow Codex CLI 提示词 runner
  -> 结构化 JSON/Markdown 报告
  -> 人工确认后的后续动作
```

这样 Codex CLI 做它擅长的部分：读 diff、解释风险、检查 hot-zone 交互、草拟候选动作、写交接报告。它不成为无人值守修改生产状态的最终权威。

## 流水线总览

```mermaid
flowchart TD
  Upstream["NapNeko/NapCatQQ latest release"] --> Audit["KT-NapCatQQ-Upstream-Sync"]
  Nas["NAS 常驻 runner"] --> Audit
  Fork["KT NapCatQQ fork"] --> Audit
  Audit --> Report["审计报告 artifact"]
  Audit --> Candidate["可选 kt/sync/<tag> 候选分支"]
  Candidate --> Human["人工审查与确认"]
  Fork --> Release["KT-NapCatQQ-Runtime-Release"]
  Human --> Release
  Release --> Image["kt-napcat-desktop-cn:<profile>"]
  Image --> ApiDeploy["API Jenkins 带运行时参数发布"]
  ApiDeploy --> Observe["deploy-observation + 线上 smoke"]
```

需要两个 Jenkins job：

```text
KT-NapCatQQ-Upstream-Sync
KT-NapCatQQ-Runtime-Release
```

上游同步 job 定时执行，默认只读。运行时发布 job 手动触发，或者由已经人工确认的候选分支触发。

所有定时执行都必须跑在 NAS 上。优先使用 Jenkins，因为它已经负责构建日志和 artifact；如果这个 job 暂时不适合放 Jenkins，就用 NAS 服务定时器，例如 `systemd` timer，执行同一套脚本和 artifact 目录。笔记本可以手动触发任务，但不能作为 scheduler。

## 上游同步审计 Job

### 触发方式

- 在 NAS 上定时触发，例如每天一次。
- 手动触发，可指定 `UPSTREAM_RELEASE_TAG`。

### 输入

```text
UPSTREAM_REPO=NapNeko/NapCatQQ
FORK_BRANCH=kt/runtime-maintenance
LAST_ACCEPTED_UPSTREAM_BASE=<上一次已接入 release marker 里的 commit>
UPSTREAM_RELEASE_TAG=<可选手动指定>
CREATE_CANDIDATE_BRANCH=false
```

### 步骤

1. 获取上游元数据。
   - 如果 `UPSTREAM_RELEASE_TAG` 为空，调用 GitHub latest release API。
   - 把 release tag 解析成 peeled commit。
   - 记录 release 名称、tag、commit、发布时间和 release URL。

2. 拉取 fork 与上游历史。
   - fetch `upstream`。
   - fetch KT 可写 `origin`。
   - checkout `FORK_BRANCH`。
   - 确认工作区干净。

3. 计算上游 delta。
   - `upstreamDelta = LAST_ACCEPTED_UPSTREAM_BASE..UPSTREAM_RELEASE_COMMIT`
   - 记录 commit、变更文件、rename/delete、lockfile 变化、hot zone 命中。

4. 计算 KT fork patch。
   - `forkPatch = LAST_ACCEPTED_UPSTREAM_BASE..FORK_BRANCH`
   - 记录 KT-only commit 和文件。

5. 检测重叠和风险。
   - `overlapFiles = 上游 delta 文件 ∩ KT patch 文件`
   - `hotZoneFiles = 上游 delta 中命中登录/运行时/构建模式的文件`
   - 运行 `git merge-tree` 或等价 dry merge。
   - 能生成候选 rebase 时运行 `git range-diff`。

6. 分类 release。
   - `safe-candidate`：没有 hot zone、没有 KT patch 文件重叠、lockfile/build 变化通过静态检查。
   - `manual-review`：命中 hot zone、命中重叠、package/build 图变化、或 range-diff 不平凡。
   - `blocked`：dry merge 冲突、依赖安装/构建失败、artifact 结构变化、上游元数据无法验证。

7. 输出 artifact。
   - Markdown 人类报告。
   - JSON 机器报告。
   - 上游 delta、KT patch、重叠文件、hot zone 文件列表。
   - 推荐下一步动作。

8. 可选创建候选分支。
   - 只有 `safe-candidate` 或人工显式要求时允许。
   - 分支名：`kt/sync/<release-tag>`。
   - 候选分支是在上游 release 上应用 KT patch，不合回 `FORK_BRANCH`。
   - 候选分支只能推到 KT 可写 remote。
   - 候选分支永远不能自动 merge。

9. 归档 NAS 本地 artifact。
   - 报告写入 `/vol1/docker/kt-codex/artifacts/napcat-upstream-sync/<timestamp>`。
   - Jenkins 归档同一份报告。
   - 报告必须包含 NAS runner hostname、可用时的 Codex CLI version、Git version、workspace manifest revision。
   - 启用 Codex CLI 自动化时，必须归档精确 prompt、context packet、JSONL event log、final response 和 output schema 校验结果。

### Hot Zone

这些路径视为高风险区域：

```text
packages/napcat-core/**/login*
packages/napcat-core/**/qrcode*
packages/napcat-shell/**
packages/napcat-framework/**
packages/napcat-webui-backend/**/QQLogin*
packages/napcat-webui-backend/**/Data*
packages/napcat-webui-backend/**/auth*
packages/napcat-webui-frontend/**
packages/napcat-adapter/**
packages/napcat-onebot/**
packages/napcat-vite/**
package.json
pnpm-lock.yaml
tsconfig*.json
vite*.ts
```

这份列表故意保守。只要上游改到登录状态、二维码生成、WebUI auth、OneBot 启动或构建打包，就必须人工审查。

### 审计报告契约

JSON artifact：

```json
{
  "upstream": {
    "repo": "NapNeko/NapCatQQ",
    "releaseTag": "v0.0.0",
    "releaseCommit": "0000000000000000000000000000000000000000",
    "publishedAt": "2026-06-24T00:00:00Z",
    "releaseUrl": "https://github.com/NapNeko/NapCatQQ/releases/tag/v0.0.0"
  },
  "fork": {
    "branch": "kt/runtime-maintenance",
    "headCommit": "0000000000000000000000000000000000000000",
    "lastAcceptedUpstreamBase": "0000000000000000000000000000000000000000"
  },
  "classification": "manual-review",
  "reasonCodes": ["HOT_ZONE_CHANGED", "FORK_PATCH_OVERLAP"],
  "upstreamChangedFiles": [],
  "forkPatchFiles": [],
  "overlapFiles": [],
  "hotZoneFiles": [],
  "candidateBranch": null,
  "recommendedAction": "Review hot-zone changes before creating a candidate branch."
}
```

报告必须可归档、可分享，不包含 token、secret、私有 env、QQ 密码、验证码 ticket 或 WebUI credential。

## 运行时发布 Job

### 触发方式

- 手动指定已确认的 source ref。
- 候选分支审查通过后可触发。

### 输入

```text
NAPCAT_SOURCE_REF=kt/runtime-maintenance or kt/sync/<tag>
UPSTREAM_RELEASE_TAG=<审计报告里的 tag>
UPSTREAM_RELEASE_COMMIT=<审计报告里的 commit>
RUNTIME_PROFILE=desktop-cn-vN
NAPCAT_BASE_IMAGE=mlikiowa/napcat-docker@sha256:<digest>
API_REF=main
PROMOTE_TO_API=false
CANARY_ACCOUNT_ID=<可选>
```

`NAPCAT_BASE_IMAGE` 必须在 Docker build 前解析为 digest。如果选择基于 `mlikiowa/napcat-docker:latest`，流水线必须先 pull，再解析 `RepoDigest`，实际构建和 release marker 都使用 digest。

### 步骤

1. Checkout `NapCatQQ`。
   - 使用 KT 可写 fork remote。
   - checkout `NAPCAT_SOURCE_REF`。
   - 确认工作区干净。
   - 记录 fork commit。

2. 安装和验证源码。
   - `pnpm install --frozen-lockfile`
   - 登录/运行态聚焦测试。
   - `pnpm run typecheck`
   - `pnpm run build:webui`
   - `pnpm run build:shell`
   - `pnpm run build:framework`

3. Checkout API 仓库作为构建集成依赖。
   - 使用 `API_REF`。
   - 执行 stage-build 脚本并传入 `--napcat-root`。
   - staged `fork-artifact.json` 必须包含：
     - upstream release tag
     - upstream release commit
     - last accepted upstream base
     - fork commit
     - dist sha256
     - `napcat.mjs` sha256
     - base image digest
     - Jenkins build URL

4. 构建 NAS 本地 Docker 镜像。
   - 从 staged context 构建。
   - 先打不可变 tag：

     ```text
     kt-napcat-desktop-cn:<upstream-tag>-kt.<jenkins-build>
     ```

   - verify 通过后再打推广别名：

     ```text
     kt-napcat-desktop-cn:<runtime-profile>
     ```

5. 验证镜像。
   - 起临时容器。
   - 执行 `/ci/napcat-desktop-cn/verify.sh`。
   - 验证 locale、时区、字体、XDG、容器隐藏标记、fork marker、artifact hash、关键 runtime symbol。
   - 删除临时容器。
   - 记录 image ID。

6. 归档 release 元数据。
   - `napcat-runtime-release.json`
   - Docker image inspect 输出
   - `fork-artifact.json`
   - 测试摘要

7. 可选推广到 API。
   - `PROMOTE_TO_API=true` 时，触发 API Jenkins，并传入 runtime image/profile 参数。
   - API 发布阶段通过受控参数或生成 overlay 更新 K8s runtime env。
   - 不要求每次手工编辑 `k8s/prod/api.yaml`。

8. 部署观测和 smoke。
   - 执行 API `deploy-observation`。
   - 验证 API `/health/runtime`。
   - 验证 K8s deployment generation、pod image、ready replicas、restart count 和日志。
   - 涉及 QQ 登录行为时，必须等真实账号 smoke 或明确记录“等待人工扫码”的状态，不能只凭 Jenkins/K8s 完成。

运行时发布 job 必须使用干净的 NAS job workspace，而不是长期远程开发 workspace，避免远程 Codex 会话和 Jenkins 发布同时修改同一个 checkout。

## ktWorkflow Codex CLI 自动化

实现阶段应在 `mcp/ktWorkflow` 增加 NapCat 自动化模块，例如：

```text
mcp/ktWorkflow/
  prompts/napcat/
    upstream-audit.md
    sync-candidate-review.md
    runtime-release-readiness.md
    remote-dev-handoff.md
    schemas/
      upstream-audit.schema.json
      runtime-release-readiness.schema.json
  src/tools/napcatAutomation.ts
  src/tools/napcatAutomation.types.ts
  src/tools/napcatAutomation.prompts.ts
```

提示词和 schema 属于自动化契约，所以需要进 Git。secret 绝不写进 prompt。每个 ktWorkflow tool 接收显式输入、生成 context packet、可选调用 Codex CLI、校验输出 schema，并把 artifact 写到本地 `.kt-workspace` 或 NAS `/vol1/docker/kt-codex/artifacts`。

MCP tools 应包含：

```text
kt_napcat_upstream_audit
kt_napcat_sync_candidate_review
kt_napcat_runtime_release_readiness
kt_napcat_remote_dev_handoff
kt_nas_codex_bootstrap_plan
```

CLI scripts 应包含：

```text
pnpm --dir mcp/ktWorkflow run napcat-upstream-audit -- --execute --artifact-root /vol1/docker/kt-codex/artifacts/napcat-upstream-sync
pnpm --dir mcp/ktWorkflow run napcat-sync-candidate-review -- --source-ref kt/sync/<tag>
pnpm --dir mcp/ktWorkflow run napcat-runtime-release-readiness -- --release-artifact <path>
pnpm --dir mcp/ktWorkflow run nas-codex-bootstrap -- --dry-run
```

这些 scripts 是唯一支持的 scheduler 入口。Jenkins 和 `systemd` 只调用这些 scripts，不复制审计算法。

### `upstream-audit.md`

用途：根据已采集事实，对上游 latest release 做同步风险分类。

提示词契约：

```text
You are auditing whether KT's NapCatQQ fork can safely sync an upstream NapNeko/NapCatQQ release.

Inputs:
- Upstream release metadata.
- Last accepted upstream base.
- KT fork branch and head commit.
- Upstream changed file list and commit list.
- KT fork patch file list and commit list.
- Hot-zone file list.
- Dry merge or range-diff output.

Rules:
- Do not run merge, commit, push, deploy, or edit files.
- Do not infer success from missing data.
- Classify exactly one of: safe-candidate, manual-review, blocked.
- Explain every reasonCode with file-level evidence.
- Recommend next action: no-op, create candidate branch, request human review, or block.

Output:
- JSON matching mcp/ktWorkflow/prompts/napcat/schemas/upstream-audit.schema.json.
- A concise Markdown summary safe for Jenkins artifacts.
```

NAS 推荐命令形态：

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

这个命令由 ktWorkflow 封装并捕获 JSONL event stream。这里用 `workspace-write` 是为了允许 Codex 只写 job artifact 目录下的报告文件。prompt 仍禁止源码编辑、push、merge 和 deployment。

### `sync-candidate-review.md`

用途：在任何 merge 之前审查生成的 `kt/sync/<release-tag>` 候选分支。

提示词契约：

```text
Review the candidate branch against KT's NapCat login/runtime requirements.

Must inspect:
- login service reset behavior
- QR refresh and stale QR handling
- WebUI login runtime state
- captcha and new-device flow boundaries
- package/build output structure
- test delta and missing coverage

Must not:
- edit files
- commit
- push
- mark production ready

Output:
- Critical/Important findings first.
- Required tests before merge.
- Whether this candidate can proceed to manual code review.
```

### `runtime-release-readiness.md`

用途：判断已构建运行时镜像是否可以推广到 API。

输入：

- NapCatQQ test/typecheck/build 摘要。
- `fork-artifact.json`。
- Docker image inspect 输出。
- `verify.sh` 输出。
- API integration test 输出。
- 计划发布的 runtime image/profile 值。

输出必须拆开：

- source validation
- image validation
- API promotion readiness
- online smoke readiness
- rollback pointer

### `remote-dev-handoff.md`

用途：人工打开 NAS Codex CLI 远程开发前，生成安全交接。

需要总结：

- 每个仓库的当前分支和 dirty 状态。
- 相关 artifact 目录。
- 最新 Jenkins job 状态。
- 当前 blocker。
- 下一步可安全执行的精确命令。

它不能要求 Codex 自动修改文件。

## API 推广契约

API Jenkinsfile 增加可选参数：

```text
QQBOT_NAPCAT_IMAGE_OVERRIDE=
QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE=
```

设置后，K8s deploy 阶段必须把它们作为 API deployment 的运行时 env。实现可以用 generated manifest overlay，也可以用 `kubectl set env`，但不能把 secret 写进 Git，并且要在部署证据里记录最终生效值。

API 测试需要保证：

- 生产不依赖 `latest`。
- runtime image override 路径显式存在。
- 默认 profile 仍是已知安全 fallback。
- API 不会静默降级到旧 runtime profile。

## 数据流

```mermaid
sequenceDiagram
  participant Upstream as GitHub 上游
  participant Nas as NAS Runner
  participant Sync as 上游审计 Jenkins
  participant Fork as KT NapCatQQ Fork
  participant Release as 运行时发布 Jenkins
  participant ApiRepo as API 仓库
  participant Docker as NAS Docker
  participant ApiDeploy as API Jenkins

  Nas->>Sync: 定时触发
  Sync->>Upstream: 读取 latest release 元数据
  Sync->>Fork: fetch 维护分支
  Sync->>Sync: 对比上游 delta 与 KT fork patch
  Sync-->>Fork: 可选 kt/sync/<tag>，不自动合并
  Sync-->>Sync: 归档审计报告
  Release->>Fork: checkout 已确认 source ref
  Release->>Release: test/typecheck/build webui/shell/framework
  Release->>ApiRepo: 执行 stage-build 脚本
  Release->>Docker: 构建并验证 kt-napcat-desktop-cn 镜像
  Release->>ApiDeploy: 可选带 image/profile 参数推广
  ApiDeploy-->>Release: rollout 和 smoke 证据
```

## 错误处理

- GitHub API 限流或不可用：审计标记 `blocked`，给出重试建议；除非明确允许，不用陈旧数据推断 latest。
- NAS runner 缺 Node、pnpm、Docker、Git、Codex 或 KT workspace manifest：标记 setup incomplete，不启用定时触发。
- NAS Codex auth 缺失：远程开发不可用，直到交互式登录或可信 auth 文件同步完成；如果确定性 Jenkins 审计不需要 Codex auth，则审计仍可运行。
- NAS Codex config 与生成模板漂移：remote-development smoke 失败，要求重新生成配置。
- ktWorkflow NapCat automation tool、prompt 或 schema 缺失：确定性审计仍可运行，但 AI 辅助分类标记为 unavailable。
- Codex CLI 输出不符合 schema：审计标记 `blocked`，并归档原始输出供人工查看。
- 笔记本离线或不在局域网：定时审计和运行时发布仍必须在 NAS 继续运行。
- 上游 release tag 无法解析 commit：标记 `blocked`。
- fork 可写 remote 指向上游：push 前失败。
- 工作区不干净：候选或发布前失败。
- 命中 hot-zone overlap：标记 `manual-review`，除非人工明确要求，否则不创建、不合并候选。
- dry merge 冲突：标记 `blocked`。
- `pnpm install`、测试、typecheck、shell/framework 构建失败：发布失败，不构建、不推广镜像。
- Docker base image 不能解析 digest：build 前失败。
- `verify.sh` 失败：删除验证容器，保留 artifact，不打推广 tag。
- API 推广部署成功但线上 smoke 失败：部署证据和功能闭环分开记录，并给出回滚步骤。

## 回滚

运行时回滚由 API runtime image/profile 控制：

1. 从 release artifact 找到上一个已验证 runtime image/profile。
2. 触发 API Jenkins，传入旧的 `QQBOT_NAPCAT_IMAGE_OVERRIDE` 和 profile。
3. 观察 K8s rollout。
4. 已存在的线上 NapCat 容器不自动重建。账号级迁移必须显式执行，因为容器重建会影响 QQ 设备/登录风控。

## 验证策略

### 上游同步 Job

本地/job 验证：

```powershell
pnpm --dir mcp/ktWorkflow run self-test
git diff --check
```

Jenkins dry run 必须看到：

- latest release 元数据已解析。
- last accepted upstream base 已解析。
- 上游 delta 文件列表。
- KT fork patch 文件列表。
- overlap/hot-zone 分类。
- 报告 artifact 路径。
- NAS runner hostname 和 artifact 目录。
- workspace manifest revision。

### NAS Codex 与 Workspace

NAS setup 验证：

```bash
node --version
corepack --version
pnpm --version
git --version
docker --version
codex --version
cd /vol1/docker/kt-codex/workspace/KT
git status --short --branch
pnpm --dir mcp/ktWorkflow run self-test
```

远程开发 smoke：

- `codex --version` 返回 NAS 已安装的最新 CLI 版本。
- `CODEX_HOME` 指向 `/vol1/docker/kt-codex/home/.codex`。
- `ktWorkflow` MCP 能从 Linux 路径启动。
- 上游审计 dry-run 能把报告写入 `/vol1/docker/kt-codex/artifacts`。
- NAS `config.toml` 中没有笔记本 Windows-only 路径。

Codex 自动化提示词 smoke：

```bash
CODEX_HOME=/vol1/docker/kt-codex/home/.codex \
codex exec --cd /vol1/docker/kt-codex/workspace/KT \
  --profile automation \
  --sandbox workspace-write \
  --ask-for-approval never \
  --json \
  --ephemeral \
  --output-schema /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow/prompts/napcat/schemas/upstream-audit.schema.json \
  --output-last-message /vol1/docker/kt-codex/artifacts/smoke/codex-upstream-audit.md \
  - < /vol1/docker/kt-codex/artifacts/smoke/context-packet.md
```

预期结果：JSON 符合 schema、源码无改动、Markdown 报告写入 artifact 目录。首选 smoke 通过 ktWorkflow 执行：

```bash
pnpm --dir /vol1/docker/kt-codex/workspace/KT/mcp/ktWorkflow run napcat-upstream-audit -- --dry-run --use-codex
```

### 运行时发布 Job

NapCatQQ：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter napcat-test run test -- loginQrcodeRefresh webuiLoginSourceWiring webuiQQLoginHandlers webuiLoginRuntime
corepack pnpm run typecheck
corepack pnpm run build:webui
corepack pnpm run build:shell
corepack pnpm run build:framework
```

API 集成：

```powershell
corepack pnpm exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand
corepack pnpm run typecheck
git diff --check
```

NAS 镜像：

```bash
docker build --build-arg NAPCAT_BASE_IMAGE="$NAPCAT_BASE_IMAGE_DIGEST" -t "$IMMUTABLE_TAG" -f "$STAGED_CONTEXT/ci/napcat-desktop-cn/Dockerfile" "$STAGED_CONTEXT"
docker run -d --name "$VERIFY_CONTAINER" "$IMMUTABLE_TAG"
docker exec "$VERIFY_CONTAINER" sh /ci/napcat-desktop-cn/verify.sh
docker rm -f "$VERIFY_CONTAINER"
docker tag "$IMMUTABLE_TAG" "$PROMOTION_TAG"
```

线上：

- API `deploy-observation` 通过。
- API `/health/runtime` 通过。
- 登录运行时发布必须用 canary 账号验证：要么真实登录成功，要么进入清晰的验证码/新设备/人工扫码 pending 状态，且二维码必须是 fresh，SSE/Admin 状态必须正确。

## 完成标准

- `NapCatQQ` 有独立 Jenkins 发布链路。
- NAS 有常驻 Codex CLI 和 KT 全量 workspace 环境，可支撑定时审计和远程开发。
- 定时审计能发现上游 latest release 并生成安全报告。
- 定时审计从 NAS 服务/Jenkins 运行，不从笔记本运行。
- Codex CLI 自动化通过 ktWorkflow 执行；提示词已版本化、schema 校验，并随每次 AI 辅助审计归档。
- 上游同步不会自动合并进 KT 维护分支。
- hot-zone 冲突会阻断或进入人工审查。
- 运行时镜像只从已确认 fork ref 构建，并经过容器内 verify。
- API 部署通过显式 image/profile 推广契约消费运行时镜像。
- Jenkins/K8s 部署证据和线上 QQBot/NapCat smoke 证据都齐全后，才允许宣称发布完成。
