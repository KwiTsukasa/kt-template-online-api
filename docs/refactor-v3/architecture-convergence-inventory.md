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
| QQBot Core/NapCat | none yet | none yet | current files before migration | baseline only |
| Plugin Platform/Plugins | none yet | none yet | current files before migration | baseline only |
| Admin UI | none yet | none yet | current files before migration | baseline only |
