# API/Admin Contract Matrix

| Batch | API Contract                                                                                                      | Admin Surface                                    | Smoke Evidence                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| 1     | `GET /health/runtime` plain JSON, runtime adapter internals                                                       | Runtime status remains available                 | `curl http://localhost:<port>/health/runtime`               |
| 2     | `/auth/*`, `/admin/user/*`, `/admin/menu/*`, `/admin/role/*`, `/admin/dept/*`, `/admin/dict/*`, `/admin/notice/*` | Login, menu, system pages                        | Login request, menu load, route render                      |
| 3     | `/blog/*`, `/asset/*`                                                                                             | Blog and Asset pages                             | Public Blog request, Admin list request, asset upload smoke |
| 4     | `/qqbot/account/*`, `/qqbot/command/*`, `/qqbot/rule/*`, `/qqbot/message/*`, `/qqbot/send/*`                      | QQBot core pages                                 | `/qqbot/command/test` local request                         |
| 5     | `/qqbot/plugin-platform/*`                                                                                        | Plugin upload/install/enable/config/health pages | local test plugin install and enable                        |
| 6     | plugin operations exposed through QQBot command/event routing                                                     | Existing plugin pages and operation views        | BangDream, FF14, FFLogs, Repeater smoke                     |
| 7     | `/qqbot/napcat/*`, login SSE events                                                                               | NapCat device/login progress pages               | simulated captcha and new-device session                    |
| 8     | public deployed URLs                                                                                              | deployed Admin                                   | online smoke bundle                                         |

WordPress 运行路由与 Blog 导入端点已在 Phase 1 退役。Phase 2 发布候选已移除
`blog_import_job` 的运行时与新建库契约；既有生产物理表仍保留到观察期结束并取得
新的破坏性授权，来源历史必须由授权后生成并完成恢复验证的退役备份及审计证据
保存。Argon 兼容字段继续保留。
