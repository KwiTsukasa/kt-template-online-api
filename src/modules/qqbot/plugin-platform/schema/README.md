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

Verification SQL:

```sql
SELECT COUNT(*) FROM qqbot_plugin_package WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_plugin_installation WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_plugin_runtime_event;
```
