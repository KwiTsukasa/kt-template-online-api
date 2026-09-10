---
name: qqbot-remind
description: 按官方 QQBot 提醒流程在 NAS 创建、查询、取消持久提醒，使用 KT 原生任务队列并核对真实投递结果。
---

来源：腾讯官方 tencent-connect/openclaw-qqbot，提交 a4479eea5931afdd3d504ac3b1c0860025c4d171，完整原文在 references/official.md。本运行环境是 Hermes，使用下面的工具映射；原文的 OpenClaw cronParams、isolated 会话和暖心助手提示不适用于此处，不能改变当前 SOUL。

延时或定时请求必须调用工具，不能只口头答应。调用 `mcp__kt__kt_reminder`：

- 创建每日提醒：`{"operation":"create","text":"该浇水了。","dailyAt":"18:00"}`，固定北京时间。
- 创建一次性提醒：`{"operation":"create","text":"该喝水了。","runAt":"2026-09-11T10:05:00+08:00"}`。根据当前消息时间计算真实目标时间，不照抄示例日期。
- 查询：`{"operation":"list"}`，查看已安排、已完成及失败原因。
- 取消：先查询，再传真实 id：`{"operation":"delete","id":"查询返回的任务ID"}`。

只使用当前发起人与当前聊天，不传账号、接收人或密钥。提醒直接通过 NAS 持久队列发送预先确定的正文，不创建其他聊天或人格；正文用当前人格自然表达。缺少时间才追问。创建成功只能说已安排；投递失败不能说已提醒。官方权限或主动消息限制仍会影响送达，应报告任务的实际结果。
