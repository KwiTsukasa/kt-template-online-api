# QQBot NapCat 登录与设备持久化设计

## 背景

当前 QQBot 的 NapCat 登录链路存在两个耦合问题：

- Docker 重建容器时只持久化 `/app/.config/QQ`，没有固定 MAC、hostname 和 `/etc/machine-id`，QQ 侧容易把同一账号识别成新设备。
- 密码登录或验证码登录返回 `needNewDevice` 后，后端只把 `jumpUrl` 透给 Admin，没有按 NapCat 上游流程继续执行新设备二维码获取、轮询和确认登录。

上游依据：

- NapCat Docker 官方 compose 固定 `mac_address`，并挂载 QQ 数据目录到 `/app/.config/QQ`。
- NapCat 文档说明 Docker 环境中的 QQ 数据目录位于 `/app/.config/QQ`。
- NapCat 源码中 Linux GUID 与 `/etc/machine-id` 和 MAC 相关。
- NapCat WebUI 的新设备流程为 `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`。

## 目标

本次改动以一次完整闭环为目标：

- 重建 NapCat 容器时保持稳定设备身份。
- 将快速登录、密码登录、验证码、新设备验证收敛为后端登录状态机。
- SSE 向 Admin 展示每一步中文进度和必要操作，不暴露内部 token。
- 线上完成一次当前账号的实际登录链路验证。

## 非目标

- 不绕过 QQ 安全验证，不做验证码自动求解。
- 不删除现有 QQ 登录数据，除非用户明确执行重置登录态。
- 不把账号在线状态和容器在线状态合并为同一个状态字段。
- 不新增独立 NapCat 部署方式。

## 运行时设备持久化

每个托管 NapCat 容器的数据目录维护以下持久文件：

- `$DATA_DIR/QQ`：继续挂载到 `/app/.config/QQ`。
- `$DATA_DIR/device.env`：保存 `NAPCAT_MAC_ADDRESS` 和 `NAPCAT_HOSTNAME`。
- `$DATA_DIR/machine-id`：挂载到 `/etc/machine-id:ro`。

容器创建或重建时：

1. 如果同名旧容器仍存在，优先读取旧容器的 MAC、hostname 和 `/etc/machine-id`。
2. 如果 `$DATA_DIR/device.env` 或 `$DATA_DIR/machine-id` 已存在，优先复用持久文件。
3. 如果没有可复用值，则基于容器名生成稳定的本地管理 MAC、hostname 和 32 位 machine-id。
4. `docker run` 固定 `--mac-address`、`--hostname`，并挂载 machine-id 文件。

重置登录态只清理 `$DATA_DIR/QQ` 下的登录数据，不删除 `device.env` 和 `machine-id`。

## 登录状态机

后端登录链路按固定顺序推进：

1. 快速登录：有历史会话时优先使用 `ACCOUNT/-q`。失败后进入密码登录，不清设备数据。
2. 密码登录：使用账号密码计算 MD5，调用 NapCat `PasswordLogin`。
3. 验证码阶段：`needCaptcha` 时 SSE 推送验证码 URL，Admin 提交用户完成验证后的 `ticket/randstr/sid`。
4. 新设备阶段：`needNewDevice` 时后端保存 `jumpUrl` 和 `newDevicePullQrCodeSig`，随后调用 `GetNewDeviceQRCode`。
5. 新设备轮询：后端使用 `PollNewDeviceQR` 轮询扫码状态。
6. 新设备确认：扫码确认后调用 `NewDeviceLogin`，成功后检查登录态、清理临时密码环境、绑定账号。

如果 `NewDeviceLogin` 再次返回 `needNewDevice`，状态机重新进入新设备阶段。

## SSE 与 Admin 表现

SSE 保留最近事件，刷新页面可以恢复当前阶段。Admin 只展示用户需要知道的状态：

- 正在尝试快速登录
- 快速登录失败，尝试密码登录
- 密码登录需要 QQ 安全验证
- QQ 需要新设备验证
- 新设备二维码已生成
- 已扫码，等待确认
- 新设备确认中
- 登录成功
- 登录失败及原因

Admin 不直接展示或保存 NapCat 内部轮询 token。二维码继续复用现有扫码区域展示。

## 错误处理

- 密码环境清理失败必须阻断成功，不允许把登录成功和清理失败混在一起。
- 普通 WebSocket close 不清空已有明确下线原因。
- `isOnline:false` 只能表示账号离线，不能表示容器离线。
- 新设备二维码过期时保持 session pending，并允许刷新当前阶段二维码。
- 重建容器失败时保留旧 QQ 数据目录和设备持久文件，错误写入账号或容器状态。

## 验证计划

后端单测：

- Docker 创建脚本包含稳定 `device.env`、`machine-id`、`--mac-address`、`--hostname` 和 QQ 数据挂载。
- 登录服务覆盖 `CaptchaLogin -> needNewDevice -> GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`。
- 新设备阶段刷新状态不会误判登录成功，也不会提前清理密码环境。

本地验证：

- 运行相关 Jest 单测。
- 运行类型检查。

线上验证：

- 推送后观察 Jenkins、K8s rollout、Pod 日志。
- 当前账号执行更新登录，确认 SSE 进度包含验证码和新设备阶段。
- 重建同一 NapCat 容器后检查 MAC、hostname、machine-id、QQ 数据目录仍复用同一持久值。
- 登录成功后确认容器环境不再残留临时 `NAPCAT_QUICK_PASSWORD`。

## 完成标准

- 代码、测试、文档和线上验证证据完整。
- 线上账号完成一次可用登录闭环。
- 不再因普通容器重建导致同一账号反复被识别为新设备。
- KT workflow 记录本次稳定问题点和解决方案。
