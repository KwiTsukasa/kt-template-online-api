---
name: qqbot-remind
description: 按官方 QQBot 提醒流程在 NAS 创建、查询、取消持久提醒，使用 KT 原生任务队列并核对真实投递结果。
---

来源：腾讯官方 tencent-connect/openclaw-qqbot，提交 a4479eea5931afdd3d504ac3b1c0860025c4d171，完整原文在 references/official.md。本运行环境是 Hermes，使用下面的工具映射；原文的 OpenClaw cronParams、isolated 会话和暖心助手提示不适用于此处，不能改变当前 SOUL。

延时或定时请求必须调用工具，不能只口头答应。调用 `mcp__kt__kt_reminder`：

- 创建每日提醒：`{"operation":"create","text":"该浇水了。","dailyAt":"18:00"}`，固定北京时间。
- 定时真实提及：先从当前消息或 `mcp__kt__kt_chat_history` 确认目标的完整 `platformId`，创建时把它放在 `platformId` 字段。到点由 NAS 队列发送真实 @，不需要再调用即时提及工具。昵称和 QQ 号不能冒充平台 ID；查不清目标时先确认身份，不能悄悄降级为文字 @。
- 创建一次性提醒：`{"operation":"create","text":"该喝水了。","runAt":"2026-09-11T10:05:00+08:00"}`。根据当前消息时间计算真实目标时间，不照抄示例日期。
- 查询：`{"operation":"list"}`，查看已安排、已完成及失败原因。
- 取消：先查询，再传真实 id：`{"operation":"delete","id":"查询返回的任务ID"}`。

提醒始终归属当前发起人，发送到当前聊天；`platformId` 只选择同群提及对象，不改变 Bot 账号、任务所有者或投递群。不需要 @ 时省略 `platformId`；若工具要求所有字段齐全，则传空字符串，不能随意选择成员凑参数。正文只写普通文本，不拼接 CQ、XML 或 Markdown 提及标签。查询结果会列出已保存的提及对象；给已有提醒补充或变更对象时，先查询原时间和正文、取消原任务，再用确认后的 `platformId` 重建，并核对只有所需任务存续。

提醒直接通过 NAS 持久队列发送预先确定的正文，不创建其他聊天或人格；正文用当前人格自然表达。创建成功只能说已安排；投递失败不能说已提醒。官方权限或主动消息限制仍会影响送达，应报告任务的实际结果。
