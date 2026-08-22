# QQBot Plugin Platform Schema

Plugin Platform owns plugin package, installation, lifecycle, runtime event,
operation registry, event dispatch, SDK host adapter, and account binding
persistence.

Current compatibility tables:

- `qqbot_plugin_package`
- `qqbot_plugin_installation`
- `qqbot_plugin_runtime_event`
- `qqbot_plugin_account_binding`
- `qqbot_plugin_config`

Seed linkage:

- Built-in command capabilities are exposed through the platform registry.
- Legacy `/qqbot/plugin/*` routes are contract compatibility endpoints owned by
  Plugin Platform.
- `qqbot_plugin_account_binding` is the transport-neutral account gate for both
  NapCat UIN and `qq-official:<AppID>` accounts. Command abilities remain
  operation-specific, while event dispatch and real command execution both
  require the plugin-level binding.
- Existing command and event-plugin abilities are backfilled with
  `sql/qqbot-plugin-account-binding-v1.sql`; the migration inserts only missing
  rows so a rerun cannot re-enable an explicitly disabled platform binding.

Verification SQL:

```sql
SELECT COUNT(*) FROM qqbot_plugin_package WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_plugin_installation WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_plugin_runtime_event;
```
