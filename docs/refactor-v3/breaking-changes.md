# Refactor V3 Breaking Changes

## Approved

| Area | Change | Reason | First Batch |
| --- | --- | --- | --- |
| Database | Rebuild all API-owned tables from new full schema | Current data is not important and old schema blocks clean module ownership | Batch 0 |
| SQL init | Replace historical patch scripts with `sql/refactor-v3/*` | Avoid accumulated `ALTER TABLE` history | Batch 0 |
| Admin QQBot API types | Replace old QQBot caller types with new contract | New QQBot Core, Plugin Platform, and NapCat state model | Batch 4 |

## Protected Behavior

- Admin login succeeds.
- Admin menu loads.
- Vben success/error wrappers remain stable for Admin APIs.
- `/health/runtime` remains plain JSON.
- Blog public list/detail remain available.
- QQBot command test remains available.
- QQBot status keeps OneBot, container, WebUI, and QQ login state separate.
- NapCat cleanup failure blocks success.
