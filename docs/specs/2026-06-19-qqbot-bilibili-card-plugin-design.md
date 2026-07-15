# QQBot Bilibili 卡片解析插件设计

## 背景

QQ 群内转发 Bilibili 内容时，NapCat/OneBot 上报不一定是普通文本链接。实际消息可能是纯文本、`share` 链接分享、`json` 卡片、`xml` 卡片，或轻应用卡片。当前 QQBot 插件体系已经支持事件插件与 worker 隔离，但还没有一个专门解析 Bilibili 卡片链接的插件。

本次目标是在第三期插件架构内新增一个内置事件插件，不把解析逻辑塞回 QQBot core，也不做命令层转接。

外部依据：

- OneBot v11 消息段包含链接分享、XML 消息和 JSON 消息，链接分享段携带 `url/title/content/image` 字段。
- NapCat 消息格式兼容表中，`share <JSON>`、`json`、`lightapp <JSON>` 都可能作为收到的卡片消息类型。
- Bilibili 视频基本信息可通过 `https://api.bilibili.com/x/web-interface/view?bvid=...` 或 `aid=...` 获取，返回 `title`、`owner`、`duration`、`stat`、`desc` 等字段。

## 目标

- 新增内置插件 `bilibili-card`，源根为 `src/modules/qqbot/plugins/bilibili-card`。
- 插件以事件方式监听 `message`，只在账号绑定后生效。
- 从 QQ 文本、链接分享、JSON/XML/轻应用卡片中提取 Bilibili URL。
- 支持直接 BV/av 链接与 `b23.tv` 短链。
- 解析成功后向来源会话回复一条纯文本视频信息摘要。
- 插件代码遵守第三期插件边界，不依赖 Nest、Host 服务实现、`axios`、`fs` 或旧 builtins 目录。
- 插件新增或触碰的函数、方法、事件处理器和导出函数都补齐有实际参数语义的 JSDoc。

## 非目标

- 不做图片渲染卡片。纯文本回复足以先完成稳定解析链路。
- 不新增 QQBot 命令入口，例如 `/解析B站`。
- 不自动绑定所有账号，启停仍由插件平台的账号绑定控制。
- 不保存用户分享的原始 `b23.tv` 短链，避免回显潜在分享追踪参数。
- 不解析番剧 `ep/ss/md`、动态、专栏、直播间等非视频对象。

## 插件结构

新增目录：

```text
src/modules/qqbot/plugins/bilibili-card/
  plugin.json
  src/
    index.ts
    application/
      bilibili-card-application.ts
    config/
      bilibili-card-config.ts
    domain/
      bilibili-card.types.ts
      bilibili-reply-formatter.ts
      bilibili-url-extractor.ts
      bilibili-url-parser.ts
    events/
      message/
        bilibili-card-message.handler.ts
    infrastructure/
      integration/
        bilibili-card-host.ts
        bilibili-video-client.ts
```

职责划分：

- `plugin.json` 是插件 key、事件、权限、运行时预算和配置项的唯一 manifest 来源。
- `index.ts` 只创建插件实例，适配 worker 通用 host，不写业务分支。
- `events/message` 只负责把 worker 的 `message` 事件交给 application。
- `application` 负责绑定判断、去重、解析编排、调用 Bilibili client、发送回复和 warn。
- `domain` 只放纯解析、格式化、类型与去重 key 计算，不触碰网络和平台 host。
- `infrastructure/integration` 只通过插件 host 调用 HTTP、重定向解析、发消息和配置读取。

## Manifest 与权限

插件 key 使用 `bilibili-card`。

事件定义：

```json
{
  "key": "bilibili-card.message",
  "name": "Bilibili 卡片解析",
  "eventName": "message",
  "handlerName": "handleMessage",
  "description": "解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。"
}
```

权限：

- `qqbot.event.receive`：接收 message 事件。
- `qqbot.send`：发送解析结果。
- `runtime.http`：请求 Bilibili 接口与短链重定向。
- `plugin.config.read`：读取超时、去重和文本截断配置。

运行时预算：

- `timeoutMs`: 10000。
- `maxConcurrency`: 1。

配置项：

- `QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS`: 默认 `6000`，限制 Bilibili 接口请求。
- `QQBOT_BILIBILI_CARD_MAX_REDIRECTS`: 默认 `5`，限制短链跳转层数。
- `QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS`: 默认 `600000`，同会话同链接 10 分钟去重。
- `QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH`: 默认 `80`，限制简介回复长度。

## 消息提取流程

插件收到 `QqbotNormalizedMessage` 后按顺序处理：

1. 如果 `message.selfId === message.userId`，直接忽略，避免机器人解析自己的回复。
2. 通过 host 查询当前 `selfId` 绑定的事件插件列表；没有绑定 `bilibili-card` 时直接返回。
3. 从以下来源收集字符串候选：
   - `message.messageText`
   - `message.rawMessage`
   - `rawEvent.message` 数组中的 `text.data.text`
   - `share.data.url/title/content`
   - `json.data.data` 解析后的嵌套字段
   - `xml.data.data` 原文中的 URL
   - `lightapp.data.data` 解析后的嵌套字段
   - `rawEvent` 中键名包含 `url`、`jumpUrl`、`qqdocurl`、`sourceUrl` 的字符串字段
4. 从候选字符串中提取 URL，统一去除 HTML 实体残留、尾随标点和 QQ 卡片包裹字符。
5. 只保留 `bilibili.com`、`m.bilibili.com`、`www.bilibili.com`、`b23.tv` 域名。
6. 对 URL 去重，并只处理第一条可解析为视频的 URL。

现有 core 的 `extractMessageText` 只拼接 text 段，本插件必须读取 `rawEvent`，不能依赖 core 改成卡片感知。

## URL 解析与短链处理

直接链接解析规则：

- `/video/BV...` 提取 `bvid`。
- `/video/av...` 提取 `aid`。
- URL query、hash、尾随斜杠和卡片转义字符不影响解析。

短链解析规则：

- 如果 `b23.tv` 路径本身包含 BV 或 av，直接解析。
- 如果 `b23.tv` 是随机短码，插件调用 host 的 `resolveRedirect`。
- `resolveRedirect` 返回最终 URL 和跳转链，不返回 body，不暴露底层 HTTP client。
- `resolveRedirect` 只接受 `http:` 和 `https:`，最多跳转配置指定次数。
- 最终 URL 必须仍属于允许域名集合，否则插件忽略该消息并记录 warn。

为支持短链，需要在插件平台增加通用 host 能力：

```ts
resolveRedirect(input: {
  url: string;
  maxRedirects?: number;
  timeoutMs?: number;
}): Promise<{ finalUrl: string; redirects: string[] }>;
```

该能力属于平台通用 HTTP 能力，不包含 Bilibili 业务判断。插件侧负责判断域名与视频 ID。

## Bilibili 接口访问

`BilibiliVideoClient` 只通过 host 访问：

- BV 链接请求 `https://api.bilibili.com/x/web-interface/view?bvid=<bvid>`。
- av 链接请求 `https://api.bilibili.com/x/web-interface/view?aid=<aid>`。
- 请求超时使用 `QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS`。
- 只接受 `code === 0` 且 `data.bvid` 存在的响应。
- `-400`、`-403`、`-404`、`62002`、`62004`、`62012` 等错误只记录 warn，不在群内刷失败消息。

## 回复格式

成功回复纯文本：

```text
Bilibili 视频解析
标题：<title>
UP：<owner.name>
时长：<mm:ss 或 hh:mm:ss>
播放：<view> 弹幕：<danmaku> 点赞：<like>
链接：https://www.bilibili.com/video/<bvid>
简介：<截断后的 desc>
```

规则：

- 缺失字段显示为 `未知` 或省略简介行。
- 数字按中文阅读习惯做轻量格式化，例如 `1.2万`。
- 简介去掉多余换行，长度由配置限制。
- 不回显原始短链。

## 去重与降噪

去重 key：

```text
<selfId>:<messageType>:<targetId>:<normalizedVideoId>
```

行为：

- 命中去重 TTL 时不请求 Bilibili 接口，也不发送回复。
- 每条消息最多回复一次。
- 网络失败、接口失败和非视频链接都不写入去重，避免短暂失败后无法重试。

## 数据与管理面

SQL seed 增加 `qqbot_plugin`、`qqbot_plugin_version`、`qqbot_plugin_installation`、`qqbot_plugin_event_handler` 对应记录，使新库能在插件平台页面看到 `bilibili-card`。

不新增 `qqbot_command` 或 `qqbot_plugin_operation` 记录，因为本插件没有命令 operation。

Admin 现有插件平台页面应能通过 manifest/seed 展示插件、事件能力和账号绑定；本次不新增专门页面。

## 错误处理

- 消息结构异常：忽略并 warn，不能抛出到 worker 队列导致事件分发失败。
- JSON 卡片解析失败：继续使用原始字符串抽 URL。
- XML 卡片解析失败：按普通字符串抽 URL。
- 短链跳转超过上限：warn 并忽略。
- 跳转到非允许域名：warn 并忽略。
- Bilibili 接口错误：warn 并忽略。
- 发消息失败：warn，不重试，避免重复回复。

## 测试策略

TDD 顺序：

1. URL 提取测试先失败：覆盖文本链接、`share` 段、`json` 卡片、`xml` 卡片、`b23.tv` 短链和非 B 站链接。
2. URL 解析测试先失败：覆盖 BV、av、尾随标点、query/hash、非法域名。
3. 应用测试先失败：未绑定不处理、绑定后解析成功发送摘要、self message 忽略、同会话同视频去重。
4. Bilibili client 测试先失败：`code === 0` 成功、错误 code warn、不接受缺失 `bvid` 的响应。
5. host `resolveRedirect` 测试先失败：跟随 302、相对 Location、超过上限、非法协议。
6. 架构门禁测试更新：新插件必须有 `plugin.json`、`src/index.ts`，不能导入 Nest、axios、fs、旧 builtins 或 host 内部实现。
7. SQL/manifest 测试更新：内置插件列表包含 `bilibili-card`，seed/verify 能检查插件存在。

聚焦验证命令：

```powershell
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/bilibili-card/bilibili-url-extractor.spec.ts test/modules/qqbot/plugins/bilibili-card/bilibili-card-application.spec.ts test/modules/qqbot/plugin-platform/plugin-host-bridge.spec.ts --runInBand
pnpm exec jest --runTestsByPath test/modules/qqbot/plugins/plugin-platform-migration.spec.ts test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts --runInBand
pnpm run typecheck
git diff --check
```

## 验收标准

- 本地单测覆盖所有解析分支并通过。
- `pnpm run typecheck` 通过。
- `git diff --check` 通过。
- 新插件可被插件平台发现并显示事件能力。
- 线上部署后，测试账号绑定 `bilibili-card`，向绑定会话发送 Bilibili QQ 卡片或链接，Bot 回复视频摘要。
- 发送普通非 B 站链接不会回复。
- 发送同一个视频不会在 TTL 内重复刷屏。
