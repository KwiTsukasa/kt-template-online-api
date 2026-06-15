# Architecture Convergence Inventory

## Baseline

| Area | Current Evidence | Target Evidence |
| --- | --- | --- |
| API legacy roots | `src/admin`, `src/blog`, `src/minio`, `src/wordpress`, `src/qqbot` exist. | These paths do not exist. |
| API forbidden module imports | `src/modules/**` imports old roots. | No import from `@/admin`, `@/blog`, `@/minio`, `@/wordpress`, or `@/qqbot`. |
| Admin System | System pages and callers exist under `views/system` and `api/system`. | No duplicate caller/type/page state after cleanup. |
| Admin Blog/Asset | Blog, WordPress, and Asset callers/pages exist under `api/blog` and `views/blog`. | Shared list/upload/import state where behavior repeats. |
| Admin QQBot | QQBot callers/pages exist under `api/qqbot` and `views/qqbot`. | Core, Plugin Platform, and NapCat state boundaries are explicit. |

## Domain Decisions

| Domain | Deleted | Merged | Kept | Evidence |
| --- | --- | --- | --- | --- |
| Admin/Auth/Platform Config | `src/admin/example` if no active route evidence; empty old admin subdirectories | auth/user/role/menu/dept/component/dict/notice/system-log/timezone moved into `src/modules/admin/**`; duplicate old imports removed | route paths and public DTO class names kept | `rg '@/admin/' src test` returns no source hits; admin focused Jest passes |
| Blog/WordPress/Asset | old `src/blog`, `src/wordpress`, `src/minio`; legacy module wrappers after local imports replaced | MinIO internal files renamed into Asset module; Blog and WordPress controller/service/entity files moved under target modules | existing route decorators and response DTO behavior | `rg '@/blog/|@/wordpress/|@/minio/' src test` has no hits; Blog/WordPress/Asset focused tests pass |
| Runtime/Common | none yet | none yet | current files before migration | baseline only |
| QQBot Core/NapCat | old `src/qqbot/qqbot.module.ts`; old core and napcat roots after moves | account/command/config/connection/dashboard/dedupe/event/message/mqtt/permission/rule/send moved into `src/modules/qqbot/core`; NapCat login/container/persistence moved into `src/modules/qqbot/napcat` | route decorators, command parsing, send queue, device persistence, captcha, new-device, and manual QR semantics | core and NapCat focused Jest pass; `rg '@/qqbot/' src/modules/qqbot/core src/modules/qqbot/napcat` has no hits |
| Plugin Platform/Plugins | none in Task 4; old `src/qqbot/plugin` intentionally remains as Task 5 debt | none in Task 4; Task 5 will move plugin registry/controller/runtime contracts into `src/modules/qqbot/plugin-platform/**`, then delete old `src/qqbot` root | plugin HTTP routes, platform plugin keys, and legacy key compatibility | current architecture convergence spec remains red only because `src/qqbot/plugin` is still pending for Task 5 |
| Admin UI | none yet | none yet | current files before migration | baseline only |
