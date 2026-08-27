# KwiCore Mobile Home

`GET /system/mobile-home/bootstrap` 为 KwiCore 主页面提供一个禁止缓存的只读共享快照。接口要求现有 Admin JWT 与 `super` 权限，并并行复用两个权威来源：

- `EnvironmentDashboardService`：概览、智能家居和游戏使用的 `Site -> Node -> Service -> Signal` 快照。
- `AdminNoticeService`：概览与消息入口使用的最近 40 条站内信、总数和权威未读数。

Remote 页面继续使用 `/codex-remote/nodes`、短期 session 与既有 relay；设置页面继续使用 Admin SSO 和 Android 本机连接状态。Mobile Home 不复制这些状态，也不新增第二套认证、协调器或持久化。

## 本地联调

本模块不增加环境变量、数据库表或外部基础设施。它复用仓库现有的可丢弃本地环境：

```bash
pnpm start:local
```

该入口只重建 `kt_template_local*` 数据库，禁用 Bot、MQTT、DDNS 和远端写入。取得本地 Admin access token 后，可在另一终端调用：

```bash
curl -i \
  -H 'Authorization: Bearer <local-admin-access-token>' \
  http://127.0.0.1:48085/system/mobile-home/bootstrap
```

成功响应保持 `{ code: 200, msg, data }`，其中 `data.environment` 是完整环境快照，`data.notices` 只包含移动端展示白名单。任一权威来源失败时接口整体失败，不返回拼接的部分成功或伪造健康状态。
