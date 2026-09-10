---
name: qqbot-upgrade
description: 辨别官方 QQBot 升级文档的适用环境，查询 KT 当前发布入口，避免把 OpenClaw 升级脚本误执行在 Hermes。
---

来源：腾讯官方 tencent-connect/openclaw-qqbot，提交 a4479eea5931afdd3d504ac3b1c0860025c4d171，原文在 references/official.md。

原文更新的是 openclaw-qqbot。当前是 NAS Hermes 经 KT API 对接官方 QQBot，未运行 OpenClaw，因此原文的一键升级脚本不适用。不要执行远程脚本、安装 OpenClaw 或自行修改服务凭据。查询 KT 知识库中的既有发布说明及当前可用命令；只有实际存在且已获授权的更新命令才可执行。没有对应操作入口时准确报告需要维护侧走正式发布流程，不能虚报升级完成。技能不改变当前 SOUL。
