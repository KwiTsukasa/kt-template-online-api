# QQBot NapCat 会话行为、Linux Runtime 与协议风险 Profile 设计

## 背景

线上 QQBot 使用 API 通过 NAS SSH 托管多个 NapCat Docker 容器。前一阶段已经完成按账号持久化 QQ 数据目录、hostname、MAC 和 `/etc/machine-id`，避免普通容器重建被 QQ 直接识别成全新设备。

本轮用户明确的目标是：让线上 NapCat Docker 环境更像真实 Linux 环境，并把协议特征也纳入方案。这里的“协议特征”只覆盖 NapCat/OneBot 可配置项、版本漂移、发送行为和自动化行为降噪，不包括绕过 QQ 安全验证或篡改 QQ 协议签名。

设计重心需要和既有证据对齐：2026-06-12 的线上排查已经把粗粒度容器检测排在低优先级，镜像 entrypoint 也已隐藏 `/.dockerenv`、伪造部分 `/proc`/cgroup/DMI 信息。当前更可信的风险来源是“无头会话被服务端注销”的会话/行为画像。因此本设计把环境拟真定位为运行卫生和漂移可观测，不把它当成主要风控缓解手段；主要投入顺序应是会话/行为画像、登录事件最小化、官方建议的 o3Hook/IP/设备灰度，再到 Docker/Linux 运行态卫生。

只读审计得到的当前线上状态：

- 4 个线上 NapCat 容器都运行 `mlikiowa/napcat-docker:latest`。
- 已有 `bridge` 网络、固定 hostname/MAC、只读 `/etc/machine-id`、QQ 数据目录持久化。
- 容器入口脚本已隐藏部分容器痕迹：`/.dockerenv` 不存在，`/proc/1/cgroup` 为 `0::/`。
- 仍存在明显容器默认态：`/dev/shm=64M`、`CgroupnsMode=private`、`Init=<nil>`、`NAPCAT_UID/GID=0`、QQ/Xvfb 进程以 root 运行。
- 运行态 locale 只有 `C/C.utf8/POSIX`，未显式设置 `LANG` / `LC_ALL` / XDG 目录。
- 当前 hostname 形如 `kt-qqbot-napcat-<QQ号>`，稳定但不接近普通 Linux 主机名。
- 当前 MAC 前缀为 `02:42`，符合 Docker 默认风格。
- 当前 NapCat 配置里 `packetBackend=auto`，`o3HookMode=1`。
- 当前 OneBot 配置只开启反向 WebSocket，`messagePostFormat=array`、`reportSelfMessage=false`、`debug=false`、`parseMultMsg=false`。
- 当前镜像 digest、NapCat 版本、QQNT 版本需要进入常规自检证据，不能只在灰度或故障排查时临时读取。

上游资料约束：

- NapCat Docker README 确认 QQ 持久化数据路径为 `/app/.config/QQ`，配置目录为 `/app/napcat/config`，插件目录为 `/app/napcat/plugins`。
- NapCat Docker compose 示例使用 `network_mode: bridge` 并固定 `mac_address`。
- NapCat 安全页建议：频繁掉线可通过更换账号或设备改善；遇到复杂网络可调整 IP/代理；无法更换账号或设备时可尝试 `o3Hook=0` 关闭包拦截。
- NapCat 基础配置说明 OneBot 的 HTTP/WS 服务端、客户端配置结构，以及账号级 `onebot11_<uin>.json` 文件。
- Docker 文档说明 `--init`、`--shm-size`、`--network`、macvlan 等运行参数和网络模型边界；macvlan 可以让容器表现为物理网络接口，但会引入 host 访问与网络运维复杂度。

## 目标

1. 建立 `NapCat Session Behavior Profile`：降低“零客户端行为 + 永久死在线”的异常画像，而不是只做环境拟真。
2. 最小化登录事件：watchdog 恢复必须优先稳定 quick -> password，避免频繁 `docker rm -f`、重建容器、生成二维码和反复扫码。
3. 建立 `NapCat Protocol Risk Profile`：把 NapCat/OneBot 配置、`o3HookMode` 灰度、版本 pin、IP/代理证据和自动行为降噪纳入统一 profile。
4. 建立 `NapCat Linux Runtime Profile`：让托管 NapCat 容器在可控范围内更接近普通 Linux 桌面程序运行环境，但只作为运行卫生和漂移可观测项。
5. 保持现有账号设备身份稳定，避免无意迁移 hostname/MAC/machine-id 触发额外新设备验证。
6. 提供线上自检证据：容器运行态、NapCat 配置、OneBot 配置、协议风险状态、会话行为状态都能被 API 查询或记录。
7. 先以测试账号灰度闭环，再决定是否迁移现有账号的 hostname/MAC。

## 非目标

- 不绕过 QQ 验证码、新设备验证或安全验证。
- 不伪造 QQ 协议签名，不修改 QQ/NTQQ 私有协议字段。
- 不默认启用 `--privileged`、`--pid=host`、`--uts=host`、`--network=host`。
- 不直接全量切换 `o3HookMode=0`。
- 不做账号级每小时或每日发送上限，也不做变相累计硬额度。
- 不在本轮引入 macvlan/ipvlan 作为默认网络模型；它只保留为后续增强方案。
- 不把 watchdog 做成自动扫码或自动反复重建容器的兜底机制。
- 不伪造 QQ/NTQQ 私有协议字段，不用未验证的内部协议接口“模拟真人”。
- 不把会话 housekeeping 设计成消息刷量、群聊刷存在感或绕过验证码/新设备验证。

## 方案总览

本轮采用安全增量方案：

```text
QqbotNapcatContainerService
  -> NapcatRuntimeProfileService
     -> 解析账号的 Linux runtime profile
     -> 解析账号的协议风险 profile
     -> 生成 Docker run 参数、环境变量、挂载目录
     -> 生成 NapCat/OneBot 配置文件内容
  -> 远程 NAS create/recreate script
     -> 准备持久目录和 profile 文件
     -> 写入 webui/onebot/napcat 配置
     -> docker run with runtime profile
  -> NapcatRuntimeProfileInspector
     -> SSH/docker inspect/docker exec 读取运行态证据
     -> 写入最近 profile evidence
```

profile 分为四层：

1. **设备身份层**：账号稳定的 dataDir、hostname、MAC、machine-id。
2. **会话行为层**：低噪声 housekeeping、presence 状态、冷启动窗口、自动行为降噪。
3. **协议风险层**：NapCat `packetBackend` / `o3HookMode`、OneBot 配置、IP/代理证据、登录事件最小化和风险事件降载。
4. **Linux runtime 层**：镜像、UID/GID、shm、init、locale、XDG、持久目录、日志目录。

## 风险重心与优先级

本轮设计不应把“容器更像 Linux”误当成主要收益来源。基于既有证据，优先级为：

1. **会话/行为画像**：处理零客户端行为、永久死在线、冷启动后立即高频响应、自动回复长期无节律的问题。
2. **登录事件最小化**：减少 `docker rm -f`、重建、扫码、验证码、新设备验证这些登录侧风控事件。
3. **官方建议的协议杠杆**：测试账号优先灰度 `o3HookMode=0`，同时记录 IP/代理/出口证据；换号/换设备只作为人工确认的高成本手段。
4. **环境/runtime 卫生**：image pin、版本 drift、shm、locale、XDG、非 root、持久目录，用于降低噪声和提高可观测性，但不承诺解决服务端会话注销。

Docker/Linux runtime profile 的验收标准不是“看起来更像真人机器”，而是“不引入新的登录事件、不破坏现有 entrypoint 反检测、不制造 profile drift，并提供诊断证据”。

## Docker 与 Linux Runtime Profile

本层是卫生项和可观测项，不是主要风控缓解项。它的设计目标是减少明显运行态漂移、提升诊断质量、避免默认容器参数造成 QQ/Chromium 异常；若某个 runtime 改动会削弱已有 entrypoint 反检测或触发登录事件，应让位给会话/行为和登录稳定性。

### 镜像 pin

生产环境必须显式配置 `QQBOT_NAPCAT_IMAGE`，并优先使用明确 tag 或 digest。

- 允许：`mlikiowa/napcat-docker@sha256:<digest>`。
- 允许：明确版本 tag，前提是上线前记录 digest。
- 不推荐：`mlikiowa/napcat-docker:latest`。

API 的 profile inspector 需要记录当前容器实际 `RepoDigest` 与 `ImageId`，用于判断线上是否漂移。

### 进程与共享内存

Docker run 增加：

- `--init`：让容器内有 init 处理信号与子进程回收。
- `--shm-size "$NAPCAT_SHM_SIZE"`：默认建议 `512m`，后续可按内存观察调整到 `1g`。

不启用 host PID/UTS/IPC。保持容器隔离和多账号端口池模型。

### 非 root 运行

当前镜像入口脚本需要 root 做初始化，然后用 `gosu napcat` 启动 Xvfb 与 QQ。我们不改镜像入口行为，只改变传入的 `NAPCAT_UID/GID`：

- 默认不再传 `0/0`。
- 引入 `QQBOT_NAPCAT_RUNTIME_UID` 和 `QQBOT_NAPCAT_RUNTIME_GID`，默认值使用 NAS 上专用普通 UID/GID。
- 容器启动后自检 QQ/Xvfb 进程是否已从 root 切换到该 UID/GID。

远程创建脚本在启动容器前必须检查并修正 QQ、cache、config、plugins、logs、local-share 目录归属，再用目标 UID/GID 做写入探测。权限不满足时，容器创建失败应明确记录为 runtime profile failure，而不是被吞成普通登录失败，也不能静默回退成 root 运行。

交叉风险：镜像 entrypoint 依赖 root 初始化来伪造或隐藏部分容器痕迹，然后再 `gosu napcat` 降权。实现时必须验证非 root UID/GID 不会削弱这些已存在的 entrypoint 行为，例如 `/proc`/cgroup/DMI 处理、隐藏 `/.dockerenv`、Xvfb/QQ 启动链路和 `/app` 权限。如果验证发现非 root 会破坏当前隐藏能力或登录稳定性，则非 root 只能作为后续派生镜像方案，不能在本轮静默推广。

### Locale 与 XDG

Docker env 增加：

- `LANG=C.UTF-8`
- `LC_ALL=C.UTF-8`
- `HOME=/app`
- `XDG_CONFIG_HOME=/app/.config`
- `XDG_CACHE_HOME=/app/.cache`
- `XDG_DATA_HOME=/app/.local/share`
- `TZ=Asia/Shanghai`

当前镜像只有 `C/C.utf8/POSIX`，所以第一阶段不强行生成 `zh_CN.UTF-8`，避免需要派生镜像。`C.UTF-8` 只能解决编码和稳定性问题，不能被描述成真实中国桌面环境；若后续要做更完整 locale 拟真，必须走派生镜像，包含 `zh_CN.UTF-8`、字体、时区和桌面相关环境的一致验证。

### 持久目录

每个账号的数据目录保留并扩展：

```text
$DATA_DIR/
  QQ/                 -> /app/.config/QQ
  cache/              -> /app/.cache
  local-share/        -> /app/.local/share
  config/             -> /app/napcat/config
  plugins/            -> /app/napcat/plugins
  logs/               -> /app/napcat/logs
  machine-id          -> /etc/machine-id:ro
  device.env
  runtime-profile.json
  protocol-profile.json
```

重置登录态只允许清理 QQ 登录态相关数据，不删除 `device.env`、`machine-id`、`runtime-profile.json`、`protocol-profile.json`、cache/local-share/logs，除非用户明确执行“重建设备身份”。

## 设备身份策略

### 新账号默认策略

新账号使用更接近普通 Linux/VM 的稳定身份：

- hostname：例如 `ubuntu-pc-<stableHash>` 或 `linux-pc-<stableHash>`，不包含 QQ 号、bot、napcat、docker 等词。
- MAC：不再默认把 `52:54:00` 作为“更真人”的目标。`52:54:00` 是 QEMU/KVM 风格前缀，只能表达 VM profile，不能证明比 Docker `02:42` 更低风险。新账号 MAC 策略必须作为可观测灰度项：保持当前稳定 MAC、稳定本地管理地址、VM 风格前缀三者择一，且记录登录结果。
- machine-id：继续稳定生成 32 位十六进制值并只读挂载。

### 现有账号迁移策略

现有 4 个账号已经有线上可用设备身份，本轮默认不迁移 hostname/MAC。

如果要迁移，必须走单账号灰度：

1. 记录迁移前 hostname/MAC/machine-id/登录状态。
2. 重建容器写入新 hostname/MAC。
3. 观察是否触发新设备验证。
4. 完成登录后记录新的 device evidence。
5. 至少观察一个业务窗口后再推广。

## 会话行为 Profile

行为层的目标不是“发得更少”这么窄，而是降低无头会话的异常画像：长期在线但没有任何客户端 housekeeping、登录后立刻进入自动回复、全天候同质节奏、掉线后反复重登。所有行为都必须低噪声、可审计、可关闭，并且只使用 NapCat/OneBot 已验证的公开能力；不使用未确认的内部协议字段。

### Presence 与 housekeeping

新增账号级 `session_behavior_profile`，第一阶段只允许无消息或低副作用动作：

- 登录成功后的冷启动窗口：只允许手动 smoke 和必要状态检查，自动回复、复读机、事件插件主动回复延迟启用。
- 低频 read-only housekeeping：按长间隔和 jitter 刷新自身状态、账号登录态、群/好友基础缓存或 NapCat 支持的轻量状态接口，用于避免长期零客户端行为。
- presence 状态：只有在 NapCat/OneBot 明确支持稳定公开 API 时，才允许做低频在线/离开类状态切换；如果没有公开能力，宁可不做，不写私有协议模拟。
- 活跃窗口：按账号配置工作时段/安静时段，只影响自动回复、事件插件和复读机，不强制 QQ 下线，不阻断管理员手动命令。
- 异常后低频：验证码、新设备验证、KickedOffLine、连续发送失败、刚恢复登录后进入更保守的 housekeeping 与自动回复窗口。

这些动作必须和消息发送区分：housekeeping 不计入发送预算，也不能变成群聊刷存在感。

### 节律与随机化

行为 profile 使用长周期 jitter，而不是短周期随机噪声：

- 冷启动窗口按分钟级配置。
- housekeeping 按十分钟到小时级配置。
- presence 切换如果启用，按小时级或工作时段边界触发。
- 自动回复恢复采用逐步放开：手动命令 -> 低风险文本命令 -> 图片/大消息命令 -> 自动回复/复读机。

任何随机化都要可回放：记录 profile 版本、下一次计划动作、上一次动作、跳过原因和执行结果。实现时不要使用不可解释的纯随机行为。

### 失败边界

housekeeping 或 presence 失败不能触发登录态 reset、容器重建、二维码刷新或 password retry。它只写入行为 profile evidence，并在连续失败后关闭该账号的行为扩展，保留基础登录恢复链路。

## 登录事件最小化

登录事件比普通消息发送更敏感。每次 `docker rm -f`、容器重建、二维码生成、人工扫码、新设备验证、验证码验证，都要视为一次可观察的登录侧风控事件。watchdog 的职责是降低无意义离线时间，不是自动制造新的登录事件。

### 事件分类

需要记录到账号运行态或登录事件日志的事件类型：

- `quick_attempt`：在当前设备身份和持久数据上尝试快速恢复。
- `password_attempt`：在当前账号密码凭据上尝试密码恢复。
- `container_restart`：重启同一容器实例。
- `container_recreate`：删除并重建容器，包含 `docker rm -f`。
- `manual_qr_created`：生成人工扫码二维码。
- `manual_qr_scanned`：用户扫码。
- `captcha_required`：需要验证码。
- `new_device_required`：需要新设备验证。
- `recovery_suspended`：自动恢复熔断，等待人工处理。

这些事件不属于账号级发送预算；它们用于恢复链路幂等、审计和熔断。

### Watchdog quick -> password 恢复链路

watchdog 只允许自动走以下链路：

1. 获取账号恢复租约，保证同一账号同一时间只有一个恢复流程。
2. 校验唯一主绑定和唯一目标容器；存在多绑定、多容器或账号不匹配时直接 `recovery_suspended`。
3. 复用当前容器、当前 dataDir、当前 machine-id、当前 hostname/MAC。
4. 先尝试 quick 恢复。quick 只允许使用已有历史登录态和 `ACCOUNT` 目标账号，不生成二维码。
5. quick 失败且账号保存了密码时，尝试 password 恢复。password 只允许复用当前容器或受控的一次性准备流程，不能把 `docker rm -f` 当作重复 retry。
6. password 成功后必须清理运行态密码环境；清理失败则阻断成功并写入专用错误。
7. 遇到验证码、新设备验证、二维码兜底、账号不匹配、连续恢复失败或容器/profile drift，立即停止自动链路，标记 `recovery_suspended`，只通知 Admin。

watchdog 不自动执行：

- 重置 QQ 登录态。
- 删除 QQ dataDir。
- 反复 `docker rm -f` 重建容器。
- 自动生成新二维码并等待扫码。
- 在二维码过期后自动刷新二维码。
- 在验证码或新设备验证 pending 时继续切换其他登录路径。

### 重建容器边界

容器重建只允许在明确的人工动作或一次性 profile 迁移动作里发生：

- 管理员手动“更新登录”。
- 新账号首次创建容器。
- 明确的 runtime/profile 版本迁移。
- 清理运行态密码环境的受控 rebuild，且失败必须阻断成功。

watchdog 如果发现容器不存在，可以按当前 profile 创建一次目标容器，但必须记录 `container_recreate` 并进入较长 backoff；如果下一轮仍失败，不继续重复删除重建，而是挂起等待人工处理。

### 恢复租约与熔断

新增或复用账号级恢复状态，至少表达：

- `recovery_state`: `idle` / `quick` / `password` / `suspended`
- `recovery_owner`
- `recovery_started_at`
- `last_login_event_kind`
- `last_login_event_at`
- `last_login_event_evidence`
- `next_auto_recovery_at`

`next_auto_recovery_at` 是登录恢复 backoff，不是发送频率预算。它只用于阻止 watchdog 在短时间内重复制造登录事件。

### Admin 呈现

账号页或运行态详情需要区分：

- 当前 QQ 登录态。
- 当前 OneBot 连接态。
- 当前恢复状态。
- 最近一次登录事件类型。
- 是否因验证码、新设备验证、二维码 pending 或频繁重建风险而挂起自动恢复。

用户手动触发更新登录时，Admin 要展示“这会产生一次登录事件/可能触发风控”的明确状态，而不是让 watchdog 在后台静默反复触发。

## Protocol Risk Profile

### NapCat 配置统一生成

API 创建或重建容器时统一生成以下文件：

- `webui.json`
- `napcat.json`
- `napcat_<uin>.json`
- `onebot11.json`
- `onebot11_<uin>.json`

这样默认配置与账号级配置不会漂移。账号级文件优先包含完整配置，默认文件只作为 fallback。

### NapCat 协议配置

默认 profile：

```json
{
  "packetBackend": "auto",
  "packetServer": "",
  "o3HookMode": 1,
  "bypass": {
    "hook": false,
    "window": false,
    "module": false,
    "process": false,
    "container": false,
    "js": false
  }
}
```

灰度 profile：

- `o3HookMode=0` 只允许账号级配置启用。
- 默认只用于测试账号，但它不应排在环境拟真之后；它属于官方安全页明确提到的频繁掉线排查杠杆，应在行为 profile 与登录事件最小化基础落地后尽早灰度。
- 灰度必须记录：账号、切换时间、镜像 digest、NapCat 版本、QQNT 版本、登录状态、收发测试结果、是否触发验证码/新设备/掉线。

`packetBackend` 第一阶段保持 `auto`。只有出现明确 PacketBackend 异常时，才设计单独切换策略。

### 官方建议优先级

NapCat 安全页给出的方向是换账号/设备、调整 IP/代理、必要时 `o3Hook=0`。本设计按成本和可逆性排序：

1. **`o3HookMode=0` 测试账号灰度**：低成本、可回滚，优先于大规模 Docker 环境拟真推广。
2. **IP/代理/出口证据**：记录 QQ 相关连接的出口、地域、代理策略和变化窗口；只做证据与显式配置，不在本轮自动切换全局网络。
3. **设备身份迁移**：成本最高，可能直接触发新设备验证；只允许单账号人工灰度，不默认迁移现有账号。
4. **换号**：属于业务/账号策略，不作为自动化修复手段。

实现时不能把 `o3HookMode=0` 的失败或成功归因给环境拟真；必须在同一账号、同一 image digest、同一 device identity 下对比。

### 版本与配置漂移

profile 自检必须记录：

- 容器镜像 ref、digest、image id。
- NapCat 版本。
- QQNT 版本。
- `napcat.json` / `napcat_<uin>.json` hash。
- `onebot11.json` / `onebot11_<uin>.json` hash。

版本信息属于常规 runtime/protocol evidence，不只在 `o3HookMode=0` 灰度时记录。这样线上出现登录失败、验证码、新设备验证或频繁掉线时，可以区分设备身份变化、镜像升级、NapCat/QQNT 升级和配置漂移。

### OneBot 配置

保持当前最小反向 WebSocket 模型：

- 不启用 HTTP server/client。
- 不启用 WebSocket server。
- 只启用 WebSocket client，连接 API reverse WS。
- `messagePostFormat=array`
- `reportSelfMessage=false`
- `reconnectInterval=5000`
- `heartInterval=30000`
- `debug=false`
- `parseMultMsg=false`
- `enableLocalFile2Url=false`

后续实现时应继续避免把 OneBot 心跳当作 QQ 登录态证据。OneBot 连接只证明容器与 API 通信，不证明 QQ 账号在线。

## 行为/会话画像与发送降噪

本轮不做账号级小时/日累计预算。行为层分两类：一类是无消息或低副作用的 session behavior，用来减少零客户端行为；另一类是发送降噪，用来避免自动回复和插件输出呈现机器节奏。发送降噪不能替代 session behavior。

### 保留现有实时节流

继续使用已有：

- 全局发送间隔。
- 单会话发送间隔。
- jitter。
- 命令冷却。
- 规则冷却。
- 复读机阈值、短文本限制、同会话最小间隔。

### 新增行为策略

1. **客户端 housekeeping**
   - 只调用已验证的 NapCat/OneBot 稳定能力。
   - 默认不发送群消息、不主动私聊、不修改资料。
   - 失败只记录 evidence，不触发登录 reset 或容器重建。

2. **presence profile**
   - 仅在存在公开稳定 API 时启用。
   - 使用小时级或工作时段级状态变化，不做分钟级抖动。
   - 不把在线状态变化当成登录成功证据，QQ 登录态仍以 NapCat WebUI/日志为准。

3. **自动能力逐步恢复**
   - 登录成功后先开启手动命令。
   - 再开启低风险文本命令。
   - 最后开启图片/大消息、自动回复和复读机。
   - 验证码、新设备验证、KickedOffLine 后重新进入保守恢复窗口。

### 新增发送降噪策略

1. **图片与大消息限频**
   - 图片、大 CQ 消息、长文本回复使用独立最小间隔。
   - BangDream 等图片命令不能在同一会话连续快速刷图。

2. **错误回复限频**
   - 同一命令、同一会话、同一错误摘要在短窗口内只回复一次。
   - 后续错误只写日志，不继续刷屏。

3. **冷启动低频窗口**
   - 刚登录成功后进入短时间低频模式。
   - 完成验证码或新设备验证后进入低频模式。
   - 低频模式限制自动回复、复读机、事件插件主动回复；手动命令仍允许但走正常实时节流。

4. **风险事件降载**
   - 出现 `KickedOffLine`、验证码、新设备验证、连续发送失败后，账号进入降载状态。
   - 降载期间不自动触发复读/自动回复类事件。
   - Admin 或后端 smoke 可以执行低频手动测试。
   - 恢复条件由时间窗口、重新登录成功、手动解除三者之一触发。

### 不做的行为控制

- 不统计“账号每小时最多发 N 条”或“每天最多发 N 条”。
- 不在每日零点重置任何发送额度。
- 不用累计额度阻断用户手动测试。

## 数据模型

当前 `napcat_device_identity` 继续作为设备身份真相源。

新增或扩展的持久化应保持以下边界：

### `napcat_device_identity`

继续负责：

- `account_id`
- `container_id`
- `data_dir`
- `hostname`
- `machine_id_path`
- `mac_address`
- `verification_status`
- `last_login_evidence`

不把行为风险状态塞进该表。

### `napcat_runtime_profile`

新增账号级 runtime/profile 表，建议字段：

- `id`
- `account_id`
- `container_id`
- `device_identity_id`
- `profile_version`
- `image_ref`
- `image_digest`
- `runtime_uid`
- `runtime_gid`
- `shm_size`
- `locale`
- `xdg_config_home`
- `xdg_cache_home`
- `xdg_data_home`
- `persist_cache`
- `persist_local_share`
- `persist_logs`
- `hostname_strategy`
- `mac_strategy`
- `migrate_device_identity`
- `profile_status`
- `last_check_evidence` JSON
- `last_checked_at`
- `create_time`
- `update_time`

### `napcat_protocol_profile`

新增账号级协议 profile 表，建议字段：

- `id`
- `account_id`
- `container_id`
- `profile_version`
- `packet_backend`
- `packet_server`
- `o3_hook_mode`
- `o3_hook_gray_enabled`
- `onebot_config_hash`
- `onebot_config_json` JSON
- `napcat_config_hash`
- `napcat_config_json` JSON
- `profile_status`
- `last_check_evidence` JSON
- `last_checked_at`
- `create_time`
- `update_time`

### `napcat_session_behavior_profile`

新增账号级会话行为 profile 表，建议字段：

- `id`
- `account_id`
- `profile_version`
- `enabled`
- `cold_start_until`
- `housekeeping_enabled`
- `housekeeping_interval_ms`
- `next_housekeeping_at`
- `last_housekeeping_at`
- `last_housekeeping_result`
- `presence_enabled`
- `presence_strategy`
- `last_presence_event_at`
- `next_presence_event_at`
- `auto_capability_stage`
- `last_behavior_evidence` JSON
- `create_time`
- `update_time`

该表不保存消息发送额度，不控制每天/每小时累计发送量。

### `napcat_login_event`

新增或复用登录事件日志，用于审计登录侧风控事件：

- `id`
- `account_id`
- `container_id`
- `event_kind`
- `event_source`: `admin` / `watchdog` / `runtime` / `system`
- `event_status`
- `evidence` JSON
- `created_at`

`event_kind` 至少覆盖 quick/password 尝试、容器 restart/recreate、二维码生成/扫码、验证码、新设备验证和恢复挂起。

### 风险降载状态

风险降载可先复用账号运行态字段或新增轻量状态表。设计上它不属于累计发送预算，建议保存：

- `account_id`
- `risk_mode`: `normal` / `cooldown` / `manual_only`
- `reason`
- `source_event`
- `expires_at`
- `last_evidence`

如果实现时已有合适账号状态字段，可不单独建表，但必须保证和发送日志、登录错误、OneBot 连接状态分离。

登录恢复状态可以和风险降载状态共表，也可以独立成轻量表；但它必须和 QQ 登录错误、OneBot 连接状态、发送频率控制分离，避免一次 WS close 触发自动重建容器。

## API 与 Admin 能力

### API

新增或扩展账号运行态接口，提供：

- 当前 runtime profile 摘要。
- 当前 protocol profile 摘要。
- 当前 session behavior profile 摘要。
- 最近自检证据。
- 是否存在 profile drift。
- 是否处于风险降载状态。
- 最近登录事件和下一次自动恢复时间。
- 最近 housekeeping/presence evidence。

敏感字段脱敏：

- WebUI token
- reverse WS token
- password/login runtime env
- SSH target key path 不回显私钥内容

脱敏边界必须覆盖三层：入库 profile/evidence 前、日志输出前、API/Admin 返回前。`onebot_config_json`、`napcat_config_json`、`last_check_evidence` 不允许把 token、密码、临时登录 env 原文写入数据库后再依赖展示层隐藏。

### Admin

Admin 第一阶段只需要只读展示：

- 镜像 ref/digest。
- UID/GID、shm、locale、XDG，并标注这些属于运行卫生项。
- hostname/MAC/machine-id 是否与 profile 一致。
- `packetBackend`、`o3HookMode`、OneBot 配置 hash。
- session behavior profile：冷启动窗口、housekeeping、presence、自动能力阶段。
- 登录事件：最近 `docker rm -f`/重建/扫码/验证码/新设备验证/恢复挂起记录。
- 风险降载状态和原因。

`o3HookMode=0`、hostname/MAC 迁移等危险操作必须后续单独设计确认，不在首版页面上开放全量批量按钮。

## 失败处理

- Docker run 参数不被宿主 Docker 支持时，容器创建失败并写入 profile failure。
- 非 root UID/GID 导致目录权限不正确时，容器创建失败，不回退成 root 静默运行。
- profile 自检失败不应误报登录失败，但必须在账号运行态中显示 drift。
- `o3HookMode=0` 灰度后如果出现登录失败、接口异常或发送异常，允许按账号回滚为 `1` 并重建容器。
- 风险降载不能清除已有 `lastError`，也不能把 OneBot WS close 当作 QQ 登录成功或失败。
- watchdog 恢复链路触发验证码、新设备验证或二维码兜底时必须挂起自动恢复，不能继续 `docker rm -f` 或刷新二维码。
- housekeeping/presence 失败不能触发登录 reset、密码重试、容器重建或二维码刷新，只能关闭该账号的行为扩展并记录 evidence。
- 非 root、MAC、locale 等 runtime 改动如果和 entrypoint 隐藏能力、登录稳定性或既有设备身份冲突，必须回退该 runtime 改动，而不是继续扩大灰度。

## 验证计划

### 本地/单测

- Docker create script 包含 `--init`、`--shm-size`、非 root UID/GID、locale/XDG env、cache/local-share/logs 挂载。
- 新账号 hostname/MAC 策略不包含 QQ 号、bot、napcat、docker 等词。
- 现有账号默认不迁移 hostname/MAC。
- NapCat config writer 同时生成默认文件与账号级文件。
- `o3HookMode=0` 只能通过账号级灰度配置启用。
- OneBot config 保持反向 WS 最小配置。
- session behavior 测试覆盖冷启动窗口、housekeeping 调度、presence capability detection、自动能力逐步恢复。
- housekeeping/presence 失败测试明确断言不会触发登录 reset、password retry、`docker rm -f` 或二维码刷新。
- 行为降噪测试覆盖图片/大消息限频、错误回复限频、冷启动低频、风险事件降载。
- 测试明确断言不存在账号级小时/日发送预算配置。
- watchdog 测试覆盖 quick -> password 顺序、恢复租约、同账号并发恢复去重、验证码/新设备/二维码兜底后挂起。
- watchdog 测试明确断言普通离线、OneBot WS close、密码失败重试不会触发重复 `docker rm -f`、重复生成二维码或重复扫码 session。
- 容器重建测试明确区分人工更新登录、首次创建、profile 迁移、密码环境清理 rebuild 和 watchdog 自动恢复。
- 非 root 测试必须验证 entrypoint 原有容器隐藏行为仍存在；若不存在，该 runtime profile 不允许通过。
- MAC 策略测试明确断言 `52:54:00` 不是默认“真人物理机”策略，只能作为显式 VM profile 灰度。
- locale 测试明确标注 `C.UTF-8` 只是编码卫生项，不能作为完整环境拟真通过条件。

### 线上灰度

1. 使用一个测试账号。
2. 记录旧容器 profile evidence。
3. 启用登录事件记录与 watchdog quick -> password 稳定恢复，确认不重复重建容器、不自动刷新二维码。
4. 启用 session behavior profile，观察 housekeeping/presence evidence，确认不会产生消息刷量。
5. 对测试账号灰度 `o3HookMode=0`，记录 NapCat/QQNT 版本、收发结果和掉线情况。
6. 记录 IP/代理/出口证据，确认 QQ 相关连接变化窗口。
7. 再启用 Linux Runtime Profile 卫生项，自检 Docker inspect 与容器内 runtime evidence，重点验证非 root 不破坏 entrypoint 隐藏能力。
8. 执行手动命令、图片命令、自动回复、复读机 smoke。
9. 观察至少一个业务窗口，再决定是否推广。

## 上线顺序

1. 先落 profile/evidence、自检和只读展示，明确 runtime 卫生项不是主要风控缓解项。
2. 落登录事件记录、恢复租约、watchdog quick -> password 稳定恢复和自动恢复熔断。
3. 落 session behavior profile：冷启动窗口、housekeeping、presence capability detection、自动能力逐步恢复。
4. 测试账号灰度 `o3HookMode=0`，同步记录 IP/代理/出口证据。
5. 最后对测试账号启用 Linux Runtime Profile 卫生项，先验证非 root、MAC、locale 不带来负向效果。
6. 验证登录、收发和行为 evidence 闭环。
7. 观察稳定后再讨论现有账号 hostname/MAC 迁移。

## 参考来源

- NapCat Docker README: https://github.com/NapNeko/NapCat-Docker/blob/main/README.md
- NapCat Docker compose: https://github.com/NapNeko/NapCat-Docker/blob/main/compose/ws.yml
- NapCat 安全相关: https://napneko.github.io/other/security
- NapCat 基础配置: https://napneko.github.io/config/basic
- NapCat 高级配置: https://napneko.github.io/config/advanced
- Docker run: https://docs.docker.com/reference/cli/docker/container/run/
- Docker networking: https://docs.docker.com/engine/network/
- Docker macvlan: https://docs.docker.com/engine/network/drivers/macvlan/
