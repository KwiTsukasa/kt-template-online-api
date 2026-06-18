# QQBot NapCat Runtime / Protocol Profile 中文方案

> 本文是给人读的中文方案说明。英文版 `2026-06-18-qqbot-napcat-runtime-protocol-profile-implementation-plan.md` 是给执行代理使用的逐任务实施清单，后续代码实现以英文清单为准。

## 一句话结论

这轮不是单纯把 Docker 做得更像 Linux，而是先把 QQBot 的登录事件、会话行为、协议配置和运行环境都变成可观测、可回滚、可灰度的 Profile。真正优先级是：会话/行为画像、登录事件最小化、官方建议的 `o3HookMode=0`/IP/设备迁移，最后才是 Docker/中文桌面运行态卫生。

## 当前状态

- 设计文档已确认：`docs/superpowers/specs/2026-06-18-qqbot-napcat-linux-runtime-protocol-profile-design.md`。
- 英文实施计划已生成：`docs/superpowers/plans/2026-06-18-qqbot-napcat-runtime-protocol-profile-implementation-plan.md`。
- 当前还没有进入代码实现阶段，线上规则仍按现有 NapCat 链路运行。
- 用户已确认：现有账号已经进入风控，可以做受控设备身份迁移；MAC 不走 Docker/QEMU/KVM/VMware/Hyper-V 风格前缀；`zh_CN.UTF-8` 派生镜像和真实中国桌面环境必须做；不做账号级每小时/每日发送预算。

## 总目标

1. 让每个 NapCat 账号拥有稳定、可审计的设备身份：dataDir、hostname、MAC、machine-id。
2. 让登录恢复链路稳住 quick -> password，减少无意义的 `docker rm -f`、重建容器、刷新二维码和反复扫码。
3. 建立 `Session Behavior Profile`，降低“零客户端行为 + 永久在线 + 登录后立即自动化输出”的异常画像。
4. 建立 `Protocol Risk Profile`，统一管理 NapCat/OneBot 配置、`o3HookMode` 灰度、版本 drift、出口/IP/代理证据。
5. 构建 KT 受控的 `Chinese Desktop Runtime` 派生镜像，提供 `zh_CN.UTF-8`、中文字体、fontconfig、上海时区、XDG/Home、DBus/Xvfb/QQ 进程环境。
6. Admin 先做只读证据展示，危险操作后续单独设计，不在首版开放批量按钮。

## 明确不做

- 不绕过 QQ 验证码、新设备验证或安全验证。
- 不伪造 QQ/NTQQ 私有协议签名，不写未验证的内部协议“真人模拟”。
- 不启用 `--privileged`、`--network=host`、`--pid=host`、`--uts=host`、host IPC。
- 不把 watchdog 做成自动扫码、自动刷新二维码、自动反复重建容器的兜底机制。
- 不做账号级每小时/每日累计发送预算，也不做变相累计硬额度。
- 不把 OneBot 心跳当成 QQ 登录成功证据。

## 架构分层

```text
Admin 只读展示
  -> API QQBot Core
  -> QqbotAccountNapcatRuntimePort
  -> NapCat Runtime/Profile 应用层
     -> 设备身份 Profile
     -> 登录事件 Profile
     -> Session Behavior Profile
     -> Protocol Risk Profile
     -> Chinese Desktop Runtime Profile
  -> NAS SSH / Docker / NapCat WebUI / OneBot reverse WS
```

边界原则：

- Core 只通过端口消费 NapCat 能力，不直接拼 Docker/NapCat 细节。
- NapCat 模块内部负责 profile 生成、配置写入、证据采集、恢复租约和登录事件。
- Admin 首版只展示 evidence 和状态，不直接承载危险批量迁移。
- 所有敏感字段在入库前、日志前、API 返回前三层脱敏。

## 数据表设计摘要

### `napcat_device_identity`

继续作为设备身份真相源，保存账号稳定的 dataDir、hostname、MAC、machine-id、验证状态和最近登录证据。它只管“这台设备是谁”，不塞会话行为或风险降载状态。

### `napcat_runtime_profile`

保存 Docker/中文桌面运行态证据，包括镜像 ref/digest、base digest、desktop profile version、locale、fontconfig、时区、UID/GID、shm、XDG、持久目录、自检 evidence、profile 状态。

### `napcat_protocol_profile`

保存 NapCat/OneBot 协议配置，包括 `packetBackend`、`packetServer`、`o3HookMode`、账号级灰度状态、OneBot/NapCat 配置 JSON 与 hash、版本 drift evidence。

### `napcat_session_behavior_profile`

保存会话行为策略，包括冷启动窗口、housekeeping 是否启用、下一次 housekeeping、presence 能力、自动能力阶段和最近行为 evidence。这个表不保存小时/日发送额度。

### `napcat_login_event`

记录登录侧风控事件，包括 quick 尝试、password 尝试、容器 restart/recreate、二维码生成/扫码、验证码、新设备验证、恢复挂起。它用于审计和熔断，不是消息发送预算。

### 风险降载状态

可独立成轻量表，也可落在现有账号运行态里，但语义必须独立于 QQ 登录态、OneBot 连接态和发送日志。状态只表达 `normal`、`cooldown`、`manual_only` 这类运行模式，不表达每日额度。

## 第一优先级：登录事件最小化

每一次容器删除重建、扫码、验证码、新设备验证，都会增加登录侧风险。watchdog 的目标不是“永远自动恢复”，而是“在不制造新登录事件的前提下尽量恢复”。

watchdog 自动链路只允许：

1. 获取同账号恢复租约，保证同一账号同一时间只有一个恢复流程。
2. 检查账号绑定唯一、容器唯一、账号与容器一致。
3. 复用当前容器、当前 dataDir、当前 hostname/MAC/machine-id。
4. 先 quick 恢复。
5. quick 失败且账号保存了密码时，再 password 恢复。
6. 密码登录成功后清理运行态密码环境，清理失败必须阻断成功。
7. 遇到验证码、新设备验证、二维码兜底、账号不匹配、连续恢复失败或 profile drift，立即挂起自动恢复并通知 Admin。

watchdog 明确不做：

- 不自动清理 QQ 登录态。
- 不自动删除 dataDir。
- 不反复 `docker rm -f`。
- 不自动刷新二维码。
- 不在验证码或新设备验证 pending 时切换其他登录路径。

## 第二优先级：会话行为 Profile

重点是降低无头会话画像，而不是简单“少发消息”。

首版只做低副作用行为：

- 登录成功后的冷启动窗口：先允许手动 smoke，再逐步恢复文本命令、图片命令、自动回复、复读机。
- 低频 housekeeping：刷新自身状态、账号登录态、群/好友基础缓存或 NapCat 稳定公开接口，不能变成群聊刷存在感。
- presence capability detection：只有 NapCat/OneBot 有稳定公开能力时才启用在线/离开类状态切换；没有公开能力就不做。
- 风险事件降载：出现验证码、新设备验证、KickedOffLine、连续发送失败后，自动回复/复读机进入保守状态，管理员手动命令仍可低频测试。

housekeeping 或 presence 失败只记录 evidence，不触发登录 reset、密码重试、容器重建或二维码刷新。

## 第三优先级：Protocol Risk Profile

NapCat/OneBot 配置由 API 统一生成，不再依赖手工漂移：

- `webui.json`
- `napcat.json`
- `napcat_<uin>.json`
- `onebot11.json`
- `onebot11_<uin>.json`

默认策略：

- `packetBackend=auto`
- `o3HookMode=1`
- OneBot 只启用反向 WebSocket client。
- `messagePostFormat=array`
- `reportSelfMessage=false`
- `debug=false`
- `parseMultMsg=false`
- 不启用 HTTP server/client、WebSocket server。

灰度策略：

- `o3HookMode=0` 只允许账号级灰度。
- 先用测试账号，记录 NapCat 版本、QQNT 版本、镜像 digest、登录结果、收发结果、是否触发验证码/新设备/掉线。
- 如果测试账号收益明确，再按账号批次推广。

IP/代理/出口证据：

- 本轮先做可观测，不自动全局切换网络。
- 记录账号相关连接出口、地域、代理策略和变化窗口。
- 后续是否引入账号级代理，单独做方案。

## 第四优先级：真实设备身份迁移

新账号和现有账号都走稳定设备身份，但现有账号已经被确认风控，因此允许直接迁移到真实设备风格：

- hostname 不包含 QQ 号、bot、napcat、docker 等词。
- MAC 使用真实物理设备风格 OUI catalog。
- 明确排除 Docker `02:42`、QEMU/KVM `52:54:00`、VMware、Hyper-V 等虚拟化前缀。
- machine-id 继续稳定生成并只读挂载。

迁移流程：

1. 记录迁移前 hostname/MAC/machine-id/登录状态。
2. 生成新的真实设备风格 hostname/MAC/machine-id。
3. 按登录事件最小化规则重建目标容器。
4. 如触发新设备验证，按现有新设备链路完成，不当作代码失败。
5. 登录完成后记录迁移后 evidence、登录事件和收发结果。
6. 单账号失败只回滚单账号，不做盲目全量反复重建。

## 第五优先级：Chinese Desktop Runtime

这一层是运行卫生和证据能力，不是主要风控缓解项。必须做，但不能把它的收益讲过头。

派生镜像要求：

- 基础镜像必须 pin 到明确 digest。
- 镜像内生成并启用 `zh_CN.UTF-8`。
- 默认 `LANG=zh_CN.UTF-8`、`LC_ALL=zh_CN.UTF-8`、`LANGUAGE=zh_CN:zh`。
- 时区固定 `Asia/Shanghai`。
- 安装可再分发中文字体，预生成 fontconfig cache。
- `fc-match` 能解析常见中文字体 fallback。
- 保持上游 QQ/Xvfb/NapCat entrypoint 行为，不破坏隐藏容器痕迹的初始化逻辑。
- 支持 XDG/Home、cache、local-share、config、plugins、logs 持久化。

Docker run 运行态：

- 增加 `--init`。
- 增加 `--shm-size`，默认建议 `512m`。
- 不启用 host PID/UTS/IPC/network。
- 默认不再以 root 运行 QQ/Xvfb，改用 NAS 专用普通 UID/GID。
- 非 root 改动必须验证没有削弱 entrypoint 现有容器隐藏行为。

持久目录建议：

```text
account-data/
  QQ/
  cache/
  local-share/
  config/
  plugins/
  logs/
  machine-id
  device.env
  runtime-profile.json
  protocol-profile.json
```

重置登录态时不得删除 device/profile/cache/local-share/logs，除非用户明确执行“重建设备身份”。

## API 和 Admin 首版能力

API 首版提供只读接口：

- runtime profile 摘要。
- protocol profile 摘要。
- session behavior profile 摘要。
- profile drift。
- 最近登录事件。
- 风险降载状态。
- 下一次自动恢复时间。
- 最近 housekeeping/presence evidence。

Admin 首版做只读 Drawer：

- 镜像 ref/digest、base digest、desktop profile version。
- `zh_CN.UTF-8`、字体/fontconfig、时区、XDG、UID/GID、shm。
- hostname/MAC/machine-id 一致性。
- `packetBackend`、`o3HookMode`、OneBot 配置 hash。
- 冷启动窗口、housekeeping、presence、自动能力阶段。
- 最近 `docker rm -f`、重建、扫码、验证码、新设备验证、恢复挂起记录。
- 风险降载原因和解除时间。

首版不开放批量 `o3HookMode=0`、批量设备迁移、批量清登录态等危险按钮。

## 分期落地路径

### Phase 1：表结构和门禁

- 建 profile/event/risk 相关表。
- 加 SQL verify。
- 加 no daily/hour budget、MAC 前缀排除、敏感字段脱敏的测试门禁。

### Phase 2：设备身份和配置生成

- 收敛 hostname/MAC/machine-id 策略。
- 引入真实物理设备风格 OUI catalog。
- 统一生成 NapCat/OneBot 配置并计算 hash。
- 记录 profile drift evidence。

### Phase 3：登录事件和 watchdog 稳定化

- 加恢复租约。
- 记录登录事件。
- 强制 watchdog 只走 quick -> password。
- 遇到验证码、新设备验证、二维码兜底和连续失败时挂起自动恢复。

### Phase 4：Session Behavior Profile

- 实现冷启动窗口。
- 实现 housekeeping 调度和 evidence。
- 实现 presence capability detection。
- 实现自动能力逐步恢复和风险降载。

### Phase 5：Chinese Desktop Runtime

- 构建 KT 派生镜像。
- 验证 `zh_CN.UTF-8`、中文字体、fontconfig、时区、XDG、DBus/Xvfb/QQ 进程环境。
- 引入 `--init`、`--shm-size`、非 root UID/GID。
- 验证不破坏 entrypoint 现有隐藏能力。

### Phase 6：API/Admin 只读闭环

- 暴露 runtime/protocol/session behavior/login event 只读接口。
- Admin 账号页接 Runtime Profile Drawer。
- 页面明确区分 QQ 登录态、OneBot 连接态、容器状态、恢复状态。

### Phase 7：线上灰度和迁移

- 测试账号先跑完整 profile 自检和收发 smoke。
- 测试账号灰度 `o3HookMode=0`。
- 测试账号做真实设备身份迁移。
- 现有风控账号按批次迁移。
- 每个账号记录迁移前后 evidence、登录事件、收发结果和回滚点。

## 验收标准

本轮完成后，至少要能证明：

- API 能查询每个账号的 runtime/protocol/session behavior profile。
- 登录事件能区分 quick、password、restart、recreate、QR、captcha、新设备、suspended。
- watchdog 不会自动进入 QR、不反复 `docker rm -f`、不自动刷新二维码。
- `o3HookMode=0` 只能账号级灰度，且有版本/digest/收发证据。
- MAC 策略排除 Docker/QEMU/KVM/VMware/Hyper-V 前缀。
- Chinese Desktop 派生镜像通过 `zh_CN.UTF-8`、fontconfig、时区、XDG、QQ/Xvfb 进程、entrypoint 行为验证。
- Admin 能只读展示 profile evidence 和风险状态。
- 没有账号级小时/日累计发送预算配置。
- 敏感字段不会进入日志、API 响应或未脱敏 evidence。
- 线上至少完成一个测试账号闭环，再迁移现有账号。

## 回滚策略

- 表结构新增不影响旧链路，必要时先停用 profile 服务，不删除数据。
- `o3HookMode=0` 可按账号回滚到 `1`。
- Chinese Desktop Runtime 失败时可按账号回滚到旧镜像 ref，但保留 profile evidence。
- 非 root UID/GID 失败时只回退进程用户策略，不回退中文 locale/字体/时区镜像建设。
- 设备身份迁移失败时只回滚单账号的 device identity，不并发重建其他账号。
- watchdog 熔断后等待人工处理，不用自动重试掩盖问题。

## 和英文实施计划的关系

- 本中文文档用于确认方向、边界、风险和验收。
- 英文实施计划用于执行，里面有具体文件、测试、提交节奏和任务拆分。
- 后续开始实现时，应按英文计划走 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。
- 如果实现阶段发现英文计划与本中文方案冲突，以本中文方案的目标和边界为准，再同步修订英文计划。
