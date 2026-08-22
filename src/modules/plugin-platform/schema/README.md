# Bot Plugin Platform Schema

Plugin Platform owns plugin package, installation, lifecycle, runtime event,
operation registry, event dispatch, SDK host adapter, and account binding
persistence.

Current compatibility tables:

- `plugin_package`
- `plugin_installation`
- `plugin_runtime_event`
- `plugin_account_binding`
- `plugin_config`

Seed linkage:

- Built-in command capabilities are exposed through the platform registry.
- Legacy `/plugin-platform/catalog/*` routes are contract compatibility endpoints owned by
  Plugin Platform.
- `plugin_account_binding` is the transport-neutral account gate for both
  NapCat UIN and `qq-official:<AppID>` accounts. Command abilities remain
  operation-specific, while event dispatch and real command execution both
  require the plugin-level binding.
- Existing command and event-plugin abilities are backfilled with
  `sql/plugin-account-binding-v1.sql`; the migration inserts only missing
  rows so a rerun cannot re-enable an explicitly disabled platform binding.

Verification SQL:

```sql
SELECT COUNT(*) FROM plugin_package WHERE is_deleted = 0;
SELECT COUNT(*) FROM plugin_installation WHERE is_deleted = 0;
SELECT COUNT(*) FROM plugin_runtime_event;
```
