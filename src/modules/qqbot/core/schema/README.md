# QQBot Core Schema

Core owns account, command, rule, permission, message, conversation, config,
dedupe, and send-log persistence.

Primary tables:

- `qqbot_account`
- `qqbot_account_ability`
- `qqbot_command`
- `qqbot_command_log`
- `qqbot_config`
- `qqbot_conversation`
- `qqbot_dedupe`
- `qqbot_message`
- `qqbot_allowlist`
- `qqbot_blocklist`
- `qqbot_rule`
- `qqbot_send_log`

Seed linkage:

- Online command rows bind to accounts through `qqbot_account_ability`.
- Core command rows refer to plugin capabilities by `plugin_key` and
  `operation_key`; execution is delegated through `QQBOT_PLUGIN_EXECUTION_PORT`.

Verification SQL:

```sql
SELECT COUNT(*) FROM qqbot_account WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_command WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_account_ability WHERE is_deleted = 0;
```
