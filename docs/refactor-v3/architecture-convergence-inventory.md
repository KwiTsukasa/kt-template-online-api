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
| Admin/Auth/Platform Config | none yet | none yet | current files before migration | baseline only |
| Blog/WordPress/Asset | none yet | none yet | current files before migration | baseline only |
| Runtime/Common | none yet | none yet | current files before migration | baseline only |
| QQBot Core/NapCat | none yet | none yet | current files before migration | baseline only |
| Plugin Platform/Plugins | none yet | none yet | current files before migration | baseline only |
| Admin UI | none yet | none yet | current files before migration | baseline only |
