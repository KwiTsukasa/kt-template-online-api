# QQBot NapCat 源码 Fork 二维码刷新修复实施计划（中文）

> **执行说明：** 按 KT 本地工作流逐项执行，并用文内复选框跟踪计划状态。

**目标：** fork NapCatQQ 源码，在源代码层修复 WebUI 登录态 stale 导致二维码无法刷新的问题，并通过 KT `desktop-cn-v3` 派生镜像上线验证。

**架构：** 先在 NapCatQQ fork 内修复登录态模型和 QR refresh 可观测性，再让 KT API 的中文桌面镜像消费源码构建产物，替换原来的 bundled JS 字符串补丁。API 侧继续保留旧二维码防护，作为 NapCat/QQ 内核异常时的第二道保护。

**技术栈：** NapCatQQ monorepo、TypeScript、Vitest、Vite Shell build、NestJS API、Jest、Docker、NAS SSH、Jenkins/K8s。

---

## 文件结构

### NapCatQQ Fork

目标仓库：`D:\MyFiles\KT\GitHub\NapCatQQ`

- 修改 `packages/napcat-webui-backend/src/types/index.ts`
  - 增加登录运行态、QR revision、QR refresh 结果类型。
- 修改 `packages/napcat-webui-backend/src/helper/Data.ts`
  - 登录运行态真相源：负责 `QQLoginStatus`、`selfInfo.online`、二维码缓存、revision、stale reconcile。
- 修改 `packages/napcat-webui-backend/src/api/QQLogin.ts`
  - 所有登录 HTTP handler 改用统一真实在线态判断。
- 修改 `packages/napcat-shell/base.ts`
  - Shell 模式 QR refresh callback 返回 `loginService.getQRCodePicture()` 的 accepted 状态。
- 修改 `packages/napcat-framework/napcat.ts`
  - Framework 模式 QR refresh callback 同步返回 accepted 状态。
- 修改 `packages/napcat-test/vitest.config.ts`
  - 增加 WebUI backend 测试 alias。
- 新增 `packages/napcat-test/webuiLoginRuntime.test.ts`
  - 覆盖 stale 登录态 reconcile、QR revision、QR refresh accepted/updated。
- 新增 `packages/napcat-test/webuiQQLoginHandlers.test.ts`
  - 覆盖 stale 登录态下 handler 不再返回 `QQ Is Logined`。
- 新增 `packages/napcat-test/webuiLoginSourceWiring.test.ts`
  - 静态检查 Shell/Framework callback 是否返回内核 accepted 状态。

### KT API 仓库

目标仓库：`D:\MyFiles\KT\Node\kt-template-online-api`

- 新增 `scripts/napcat-desktop-cn-stage-build.mjs`
  - 把 NapCatQQ fork 的 Shell dist staged 成 Docker build context。
- 修改 `ci/napcat-desktop-cn/Dockerfile`
  - 从 staged context 复制源码构建产物，生成 `/app/NapCat.Shell.zip`。
- 修改 `ci/napcat-desktop-cn/verify.sh`
  - 校验 fork marker、artifact hash、locale、timezone、XDG、fontconfig 和源码修复 marker。
- 删除 `ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh`
  - 不再做 bundled JS 字符串 patch。
- 修改 `ci/napcat-desktop-cn/README.md`
  - 写清 v3 staging/build/verify 命令。
- 修改 `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
  - 默认 desktop profile 升级到 `desktop-cn-v3`。
- 修改 `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`
  - 旧 patch 断言改成源码 artifact 断言。
- 修改 `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
  - 更新默认 runtime profile 版本断言。
- 修改 `README.md`、`API.md`
  - 记录 v3 镜像和 `QQBOT_NAPCAT_IMAGE` 要求。

### KT Root 文档

目标仓库：`D:\MyFiles\KT`

- 修改 `docs/qqbot-nas-runtime.md`
  - 记录 NapCat 源码 fork 镜像、canary 证据和上线边界。
- 修改 `TASKS.md`
  - 增加本轮双语计划和后续实施上下文。

## 执行规则

- 不创建 `.worktree`，按用户要求使用普通 dev 分支。
- canary 任务之前不改生产容器。
- 不删除 API 侧旧二维码防护。
- 不推送，除非用户明确要求。
- KT 自有新增/触达函数必须有 JSDoc，参数说明要写用途，不复读变量名。
- 每个代码任务必须先跑 RED，再实现，再跑 GREEN。

## Task 1：准备 NapCatQQ Fork 分支

**文件：**

- 创建或更新 `D:\MyFiles\KT\GitHub\NapCatQQ`

- [ ] 拉取或克隆上游 `NapNeko/NapCatQQ`。
- [ ] 从 `main` 创建 `codex/qr-refresh-login-state`。
- [ ] 确认基线 commit 当前为 `5c18a62530d87dbadf53d267002894faa6ca7e90`；如上游前进，则记录实际 commit。
- [ ] 确认 `package.json` 有 `typecheck`、`test`、`build:shell`。

验证命令：

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' rev-parse HEAD
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --version
```

预期：分支存在，脚本入口可用。

## Task 2：新增 NapCat 登录运行态失败测试

**文件：**

- 修改 `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\vitest.config.ts`
- 新增 `D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-test\webuiLoginRuntime.test.ts`

- [ ] 在 Vitest config 增加 `napcat-webui-backend` alias。
- [ ] 新增运行态测试，覆盖：
  - `QQLoginStatus=true` 且 `selfInfo.online=false` 时 reconcile 为离线。
  - `selfInfo.online=undefined` 时不误判离线。
  - QR URL 变化时 revision 增加，重复写同 URL 不增加。
  - refresh callback 返回 `true` 且 QR callback 更新 URL 时，结果是 `accepted=true, updated=true`。
  - refresh callback 返回 `false` 时，结果是 rejected。
- [ ] 运行 RED 测试。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts
```

预期：第一次失败，原因是 `__resetForTest`、`getQQLoginRuntimeState`、`clearQQLoginQrcodeURL` 和带返回值的 `refreshQRCode` 还不存在。

## Task 3：实现 NapCat WebUI 登录运行态模型

**文件：**

- 修改 `packages/napcat-webui-backend/src/types/index.ts`
- 修改 `packages/napcat-webui-backend/src/helper/Data.ts`
- 测试 `packages/napcat-test/webuiLoginRuntime.test.ts`

- [ ] 增加类型：
  - `QQLoginRuntimeStateOptions`
  - `QQLoginRuntimeState`
  - `QQRefreshQRCodeOptions`
  - `QQRefreshQRCodeResult`
- [ ] `LoginRuntimeType` 增加：
  - `QQQRCodeRevision`
  - `QQQRCodeUpdatedAt`
  - `onRefreshQRCode: () => Promise<boolean>`
- [ ] `Data.ts` 增加 helper：
  - `delay`
  - `getCoreOnlineState`
  - `buildQQLoginRuntimeState`
  - `clearQQLoginQrcodeURL`
- [ ] `setQQLoginQrcodeURL` 只在 URL 变化时递增 revision。
- [ ] `getQQLoginRuntimeState({ reconcile, clearStaleQRCode })` 统一表达真实在线态。
- [ ] `refreshQRCode(options)` 返回 `accepted`、`updated`、`qrcodeRevision`、`qrcodeurl`。
- [ ] 增加 `__resetForTest()` 测试辅助。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-webui-backend run typecheck
```

预期：测试和 typecheck 通过。

提交：

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-webui-backend/src/types/index.ts packages/napcat-webui-backend/src/helper/Data.ts packages/napcat-test/vitest.config.ts packages/napcat-test/webuiLoginRuntime.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 修复WebUI登录态与二维码刷新状态"
```

## Task 4：修复 QQLogin handler 登录态短路

**文件：**

- 新增 `packages/napcat-test/webuiQQLoginHandlers.test.ts`
- 修改 `packages/napcat-webui-backend/src/api/QQLogin.ts`

- [ ] 新增 handler 测试，覆盖：
  - `CheckLoginStatus` 会清理 stale login state，不返回旧 QR。
  - `RefreshQRcode` 在 stale login state 下允许执行。
  - core 明确在线时 quick login 仍返回 `QQ Is Logined`。
  - stale 后 `GetQRcode` 不返回旧二维码。
- [ ] 运行 RED 测试。
- [ ] 在 `QQLogin.ts` 增加 helper：
  - `isActuallyLoggedIn(clearStaleQRCode = true)`
  - `buildLoginStatusPayload()`
- [ ] 将以下 handler 的直接 `getQQLoginStatus()` 判断改为真实在线态判断：
  - `QQGetQRcodeHandler`
  - `QQSetQuickLoginHandler`
  - `QQRefreshQRcodeHandler`
  - `QQPasswordLoginHandler`
  - `QQCaptchaLoginHandler`
  - `QQNewDeviceLoginHandler`
- [ ] `QQCheckLoginStatusHandler` 统一返回 helper payload。
- [ ] `QQRefreshQRcodeHandler` 返回 refresh result；若 rejected，则返回明确错误。
- [ ] 给触达的 exported handler 补 JSDoc。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiQQLoginHandlers.test.ts
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts webuiQQLoginHandlers.test.ts
```

预期：测试通过。

提交：

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-webui-backend/src/api/QQLogin.ts packages/napcat-test/webuiQQLoginHandlers.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 收敛QQ登录接口真实在线态判断"
```

## Task 5：打通 Shell/Framework QR refresh callback 返回值

**文件：**

- 新增 `packages/napcat-test/webuiLoginSourceWiring.test.ts`
- 修改 `packages/napcat-shell/base.ts`
- 修改 `packages/napcat-framework/napcat.ts`

- [ ] 新增静态源码测试，确认 Shell/Framework 都包含 `return loginService.getQRCodePicture();`。
- [ ] 运行 RED 测试。
- [ ] Shell 模式的 `setRefreshQRCodeCallback` 返回 `loginService.getQRCodePicture()`。
- [ ] Framework 模式同样返回 `loginService.getQRCodePicture()`。
- [ ] 运行源码 wiring 测试和两包 typecheck。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginSourceWiring.test.ts
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-shell run typecheck
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-framework run typecheck
```

预期：测试和 typecheck 通过。

提交：

```powershell
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' add packages/napcat-shell/base.ts packages/napcat-framework/napcat.ts packages/napcat-test/webuiLoginSourceWiring.test.ts
git -C 'D:\MyFiles\KT\GitHub\NapCatQQ' commit -m "fix: 返回二维码刷新请求接收状态"
```

## Task 6：构建并验证 NapCatQQ Fork Artifact

**文件：**

- 无新增文件；除非验证暴露明确编译或测试问题。

- [ ] 安装依赖。
- [ ] 跑新增 WebUI 相关 Vitest。
- [ ] 跑 NapCatQQ 现有测试。
- [ ] 跑 monorepo typecheck。
- [ ] 构建 WebUI frontend。
- [ ] 构建 Shell artifact。
- [ ] 记录 fork commit 与 `napcat.mjs` SHA256。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' install --frozen-lockfile
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run webuiLoginRuntime.test.ts webuiQQLoginHandlers.test.ts webuiLoginSourceWiring.test.ts
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-test exec vitest run
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' run typecheck
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' --filter napcat-webui-frontend run build
corepack pnpm --dir 'D:\MyFiles\KT\GitHub\NapCatQQ' run build:shell
Get-FileHash -Algorithm SHA256 'D:\MyFiles\KT\GitHub\NapCatQQ\packages\napcat-shell\dist\napcat.mjs'
```

预期：`packages/napcat-shell/dist/napcat.mjs` 存在，所有测试/typecheck/build 通过。

## Task 7：新增 API 镜像 build-context staging 脚本

**文件：**

- 新增 `scripts/napcat-desktop-cn-stage-build.mjs`
- 修改 `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`

- [ ] 在 API image test 中新增 staging script 静态断言，覆盖：
  - `napcatMjsSha256`
  - `forkCommit`
  - `upstreamBaseCommit`
  - `packages/napcat-shell/dist`
  - `fork-artifact.json`
  - `.kt-workspace/napcat-desktop-cn-build`
- [ ] 运行 RED Jest。
- [ ] 新增 staging 脚本：
  - 参数 `--napcat-root`
  - 参数 `--out`
  - 复制 `Dockerfile`、`verify.sh`、`NapCat.Shell` dist
  - 写入 `fork-artifact.json`
  - 计算 dist 与 `napcat.mjs` SHA256
  - 输出 marker 和 output root
- [ ] 跑 Jest，确认新测试通过；旧 patch 测试会在 Task 8 更新。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

预期：新增 staging 断言通过。

## Task 8：用源码 artifact 替换 bundled JS patch

**文件：**

- 修改 `ci/napcat-desktop-cn/Dockerfile`
- 修改 `ci/napcat-desktop-cn/verify.sh`
- 删除 `ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh`
- 修改 `test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts`

- [ ] 把旧 patch 断言替换为源码 artifact 断言：
  - Dockerfile 包含 `COPY NapCat.Shell /tmp/NapCat.Shell`
  - Dockerfile 包含 `fork-artifact.json`
  - Dockerfile 仍生成 `/app/NapCat.Shell.zip`
  - Dockerfile 不再包含 `qq-login-real-online-guard.sh`
  - verify 包含 `napcatMjsSha256`
  - verify 包含 `getQQLoginRuntimeState`
  - verify 包含 `qrcodeRevision`
- [ ] 运行 RED Jest。
- [ ] Dockerfile 删除 patch block，改为复制 staged Shell dist 并 zip 到 `/app/NapCat.Shell.zip`。
- [ ] verify.sh 校验：
  - locale/timezone/font/XDG
  - `/.dockerenv` 隐藏与 cgroup evidence
  - fork marker 存在
  - `NapCat.Shell.zip` 存在
  - 解压后 `napcat.mjs` hash 与 marker 一致
  - bundle 内存在 `getQQLoginRuntimeState` 与 `qrcodeRevision`
- [ ] 删除旧 patch 脚本。
- [ ] 跑 image Jest。

验证命令：

```powershell
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' rm -- 'ci/napcat-desktop-cn/patches/qq-login-real-online-guard.sh'
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts --runTestsByPath --runInBand
```

预期：Jest 通过，旧 patch 脚本被删除。

## Task 9：更新 Runtime Profile 版本与文档

**文件：**

- 修改 `src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts`
- 修改 `test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts`
- 修改 `ci/napcat-desktop-cn/README.md`
- 修改 `README.md`
- 修改 `API.md`
- 修改 `D:\MyFiles\KT\docs\qqbot-nas-runtime.md`

- [ ] 将测试预期从 `desktop-cn-v2` 改为 `desktop-cn-v3`，先跑 RED。
- [ ] 将 service 默认值改为 `desktop-cn-v3`。
- [ ] README 写清：
  - 先构建 NapCatQQ fork。
  - 再运行 staging 脚本。
  - 再 build `kt-napcat-desktop-cn:desktop-cn-v3`。
  - 再执行容器内 `verify.sh`。
- [ ] API/README/root docs 写明：生产 `QQBOT_NAPCAT_IMAGE` 应指向验证过的 v3 digest。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand --testNamePattern "resolves Chinese Desktop Runtime defaults"
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand
```

预期：RED 后 GREEN，profile 默认版本为 `desktop-cn-v3`。

## Task 10：验证 API 镜像集成并提交

**文件：**

- Task 7 到 Task 9 的所有 API/root 改动。

- [ ] 跑 API 聚焦 Jest。
- [ ] 跑 API typecheck。
- [ ] 跑 API/root diff check。
- [ ] 跑 global-review。
- [ ] API 仓库提交。
- [ ] 根仓库提交 docs/TASKS。

验证命令：

```powershell
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' exec jest test/modules/qqbot/napcat/napcat-desktop-cn-image.spec.ts test/modules/qqbot/napcat/runtime-protocol-profile.spec.ts --runTestsByPath --runInBand
corepack pnpm --dir 'D:\MyFiles\KT\Node\kt-template-online-api' run typecheck
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' diff --check
git -C 'D:\MyFiles\KT' diff --check -- TASKS.md docs/qqbot-nas-runtime.md
pnpm --dir 'D:\MyFiles\KT\mcp\ktWorkflow' run global-review
```

预期：全部通过，`global-review findings=[]`。

提交命令：

```powershell
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' add ci/napcat-desktop-cn scripts/napcat-desktop-cn-stage-build.mjs src/modules/qqbot/napcat/application/runtime/napcat-runtime-profile.service.ts test/modules/qqbot/napcat README.md API.md
git -C 'D:\MyFiles\KT\Node\kt-template-online-api' commit -m "feat: 接入NapCat源码构建镜像"
git -C 'D:\MyFiles\KT' add docs/qqbot-nas-runtime.md TASKS.md
git -C 'D:\MyFiles\KT' commit -m "docs: 记录NapCat源码构建运行态"
```

## Task 11：构建镜像并执行本地或 NAS verify

**文件：**

- 无源码文件；只有验证证据。

- [ ] 从 API 仓库运行 staging 脚本。
- [ ] 用 pinned base image 构建 `kt-napcat-desktop-cn:desktop-cn-v3`。
- [ ] 启动一次 verify 容器。
- [ ] 容器内执行 `/ci/napcat-desktop-cn/verify.sh`。
- [ ] 删除 verify 容器。
- [ ] 记录 image id/digest。

验证命令：

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --out .kt-workspace\napcat-desktop-cn-build

$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { docker pull mlikiowa/napcat-docker:latest; $baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v3 `
  -f .kt-workspace/napcat-desktop-cn-build/ci/napcat-desktop-cn/Dockerfile `
  .kt-workspace/napcat-desktop-cn-build

$name = "kt-napcat-v3-verify-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
docker run -d --name $name kt-napcat-desktop-cn:desktop-cn-v3
docker exec $name sh /ci/napcat-desktop-cn/verify.sh
docker rm -f $name
docker image inspect kt-napcat-desktop-cn:desktop-cn-v3 --format '{{.Id}}'
```

预期：镜像构建成功，verify 退出码为 0。

## Task 12：部署并进行线上 canary

**文件：**

- 无源码文件；除非线上验证暴露明确 bug。

- [ ] 用户确认后再 push。
- [ ] push NapCatQQ fork 分支。
- [ ] push API main。
- [ ] 观察 Jenkins/K8s。
- [ ] 配置生产环境：
  - `QQBOT_NAPCAT_IMAGE=kt-napcat-desktop-cn:desktop-cn-v3`
  - `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION=desktop-cn-v3`
- [ ] 只对一个用户确认账号做 canary。
- [ ] 捕获完整证据：
  - NapCat fork commit
  - NapCat image id
  - scan session id
  - old QR hash prefix
  - new QR hash prefix
  - qrcode.png old/new mtime
  - `RefreshQRcode.accepted`
  - `RefreshQRcode.updated`
  - SSE 最终状态

部署观测命令：

```powershell
pnpm --dir 'D:\MyFiles\KT\mcp\ktWorkflow' run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --execute
```

canary 通过标准：

- stale `QQLoginStatus=true + online=false` 不再返回 `QQ Is Logined`。
- NapCat 生成新 QR，或返回 `accepted=true, updated=false` 且 API 不展示旧码。
- `/app/napcat/cache/qrcode.png` hash/mtime 能证明是否真的产码。
- API `scan/status` 不返回旧 QR hash。
- Admin/SSE 显示新 QR 或明确 pending 原因。

## 自检清单

- 源码 fork：Task 1-6 覆盖。
- stale 登录态修复：Task 2-4 覆盖。
- QR refresh 可观测：Task 2、3、5、12 覆盖。
- WebUI handler 不回旧码：Task 4 覆盖。
- API 防旧码保留：Task 7-10 不改 API 登录 service。
- 源码 artifact 镜像：Task 7-11 覆盖。
- 本地与线上验证：Task 6、10、11、12 覆盖。
- 本中文计划已完成自检。
