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

WordPress 运行路由与 Blog 导入端点已在 Phase 1 退役。Phase 2 直接退役已于
2026-07-31 获得用户明确授权：正常 API 进程不再注册离线资源迁移器及其
HTTP/DNS provider，`blog_import_job` 也已从运行时与新建库契约移除。生产
物理表和五个 `WORDPRESS_*` key 只能在专用密文备份完成无网络恢复验证后精确
移除；原 WordPress 容器对象和 bind 数据继续保留为回滚资产。Argon 兼容字段
继续保留。
