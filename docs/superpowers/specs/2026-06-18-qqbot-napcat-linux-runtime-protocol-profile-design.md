# QQBot NapCat Linux Runtime 与协议风险 Profile 设计

## 背景

线上 QQBot 使用 API 通过 NAS SSH 托管多个 NapCat Docker 容器。前一阶段已经完成按账号持久化 QQ 数据目录、hostname、MAC 和 `/etc/machine-id`，避免普通容器重建被 QQ 直接识别成全新设备。

本轮用户明确的目标是：让线上 NapCat Docker 环境更像真实 Linux 环境，并把协议特征也纳入方案。这里的“协议特征”只覆盖 NapCat/OneBot 可配置项、版本漂移、发送行为和自动化行为降噪，不包括绕过 QQ 安全验证或篡改 QQ 协议签名。

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

1. 建立 `NapCat Linux Runtime Profile`：让托管 NapCat 容器在可控范围内接近普通 Linux 桌面程序运行环境。
2. 建立 `NapCat Protocol Risk Profile`：把 NapCat/OneBot 配置、`o3HookMode` 灰度、版本 pin 和自动行为降噪纳入统一 profile。
3. 保持现有账号设备身份稳定，避免无意迁移 hostname/MAC/machine-id 触发额外新设备验证。
4. 提供线上自检证据：容器运行态、NapCat 配置、OneBot 配置、协议风险状态都能被 API 查询或记录。
5. 先以测试账号灰度闭环，再决定是否迁移现有账号的 hostname/MAC。

## 非目标

- 不绕过 QQ 验证码、新设备验证或安全验证。
- 不伪造 QQ 协议签名，不修改 QQ/NTQQ 私有协议字段。
- 不默认启用 `--privileged`、`--pid=host`、`--uts=host`、`--network=host`。
- 不直接全量切换 `o3HookMode=0`。
- 不做账号级每小时或每日发送上限，也不做变相累计硬额度。
- 不在本轮引入 macvlan/ipvlan 作为默认网络模型；它只保留为后续增强方案。

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

profile 分为三层：

1. **设备身份层**：账号稳定的 dataDir、hostname、MAC、machine-id。
2. **Linux runtime 层**：镜像、UID/GID、shm、init、locale、XDG、持久目录、日志目录。
3. **协议风险层**：NapCat `packetBackend` / `o3HookMode`、OneBot 配置、发送节流和风险事件降载。

## Docker 与 Linux Runtime Profile

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

### Locale 与 XDG

Docker env 增加：

- `LANG=C.UTF-8`
- `LC_ALL=C.UTF-8`
- `HOME=/app`
- `XDG_CONFIG_HOME=/app/.config`
- `XDG_CACHE_HOME=/app/.cache`
- `XDG_DATA_HOME=/app/.local/share`
- `TZ=Asia/Shanghai`

当前镜像只有 `C/C.utf8/POSIX`，所以第一阶段不强行生成 `zh_CN.UTF-8`，避免需要派生镜像。若后续使用派生镜像，再把 `zh_CN.UTF-8` 作为增强项。

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
- MAC：可从 `02:42` 切到稳定 VM 风格前缀，例如 `52:54:00:<hash>`。
- machine-id：继续稳定生成 32 位十六进制值并只读挂载。

### 现有账号迁移策略

现有 4 个账号已经有线上可用设备身份，本轮默认不迁移 hostname/MAC。

如果要迁移，必须走单账号灰度：

1. 记录迁移前 hostname/MAC/machine-id/登录状态。
2. 重建容器写入新 hostname/MAC。
3. 观察是否触发新设备验证。
4. 完成登录后记录新的 device evidence。
5. 至少观察一个业务窗口后再推广。

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
- 默认只用于测试账号。
- 灰度必须记录：账号、切换时间、镜像 digest、NapCat 版本、QQNT 版本、登录状态、收发测试结果、是否触发验证码/新设备/掉线。

`packetBackend` 第一阶段保持 `auto`。只有出现明确 PacketBackend 异常时，才设计单独切换策略。

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

## 行为协议降噪

本轮不做账号级小时/日累计预算，只做实时节流、异常降载和自动行为降噪。

### 保留现有实时节流

继续使用已有：

- 全局发送间隔。
- 单会话发送间隔。
- jitter。
- 命令冷却。
- 规则冷却。
- 复读机阈值、短文本限制、同会话最小间隔。

### 新增降噪策略

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

### 风险降载状态

风险降载可先复用账号运行态字段或新增轻量状态表。设计上它不属于累计发送预算，建议保存：

- `account_id`
- `risk_mode`: `normal` / `cooldown` / `manual_only`
- `reason`
- `source_event`
- `expires_at`
- `last_evidence`

如果实现时已有合适账号状态字段，可不单独建表，但必须保证和发送日志、登录错误、OneBot 连接状态分离。

## API 与 Admin 能力

### API

新增或扩展账号运行态接口，提供：

- 当前 runtime profile 摘要。
- 当前 protocol profile 摘要。
- 最近自检证据。
- 是否存在 profile drift。
- 是否处于风险降载状态。

敏感字段脱敏：

- WebUI token
- reverse WS token
- password/login runtime env
- SSH target key path 不回显私钥内容

脱敏边界必须覆盖三层：入库 profile/evidence 前、日志输出前、API/Admin 返回前。`onebot_config_json`、`napcat_config_json`、`last_check_evidence` 不允许把 token、密码、临时登录 env 原文写入数据库后再依赖展示层隐藏。

### Admin

Admin 第一阶段只需要只读展示：

- 镜像 ref/digest。
- UID/GID、shm、locale、XDG。
- hostname/MAC/machine-id 是否与 profile 一致。
- `packetBackend`、`o3HookMode`、OneBot 配置 hash。
- 风险降载状态和原因。

`o3HookMode=0`、hostname/MAC 迁移等危险操作必须后续单独设计确认，不在首版页面上开放全量批量按钮。

## 失败处理

- Docker run 参数不被宿主 Docker 支持时，容器创建失败并写入 profile failure。
- 非 root UID/GID 导致目录权限不正确时，容器创建失败，不回退成 root 静默运行。
- profile 自检失败不应误报登录失败，但必须在账号运行态中显示 drift。
- `o3HookMode=0` 灰度后如果出现登录失败、接口异常或发送异常，允许按账号回滚为 `1` 并重建容器。
- 风险降载不能清除已有 `lastError`，也不能把 OneBot WS close 当作 QQ 登录成功或失败。

## 验证计划

### 本地/单测

- Docker create script 包含 `--init`、`--shm-size`、非 root UID/GID、locale/XDG env、cache/local-share/logs 挂载。
- 新账号 hostname/MAC 策略不包含 QQ 号、bot、napcat、docker 等词。
- 现有账号默认不迁移 hostname/MAC。
- NapCat config writer 同时生成默认文件与账号级文件。
- `o3HookMode=0` 只能通过账号级灰度配置启用。
- OneBot config 保持反向 WS 最小配置。
- 行为降噪测试覆盖图片/大消息限频、错误回复限频、冷启动低频、风险事件降载。
- 测试明确断言不存在账号级小时/日发送预算配置。

### 线上灰度

1. 使用一个测试账号。
2. 记录旧容器 profile evidence。
3. 重建为 Linux Runtime Profile。
4. 自检 Docker inspect 与容器内 runtime evidence。
5. 登录或更新登录，必要时完成验证码/新设备验证。
6. 执行手动命令、图片命令、自动回复、复读机 smoke。
7. 若测试 `o3HookMode=0`，先只对该账号开启，记录 NapCat/QQNT 版本、收发结果和掉线情况。
8. 观察至少一个业务窗口，再决定是否推广。

## 上线顺序

1. 先只落 profile 生成、自检和只读展示。
2. 对新建测试账号启用完整 runtime profile。
3. 灰度 `o3HookMode=0`，仅测试账号。
4. 验证登录与收发闭环。
5. 观察稳定后再讨论现有账号 hostname/MAC 迁移。

## 参考来源

- NapCat Docker README: https://github.com/NapNeko/NapCat-Docker/blob/main/README.md
- NapCat Docker compose: https://github.com/NapNeko/NapCat-Docker/blob/main/compose/ws.yml
- NapCat 安全相关: https://napneko.github.io/other/security
- NapCat 基础配置: https://napneko.github.io/config/basic
- NapCat 高级配置: https://napneko.github.io/config/advanced
- Docker run: https://docs.docker.com/reference/cli/docker/container/run/
- Docker networking: https://docs.docker.com/engine/network/
- Docker macvlan: https://docs.docker.com/engine/network/drivers/macvlan/
