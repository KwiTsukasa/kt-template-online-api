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
- `qqbot_message_subscription`
- `qqbot_message_template`
- `qqbot_message_publish_binding`
- `qqbot_message_publish_target`
- `qqbot_message_event`
- `qqbot_message_delivery`

Seed linkage:

- Online command rows bind to accounts through `qqbot_account_ability`.
- Core command rows refer to plugin capabilities by `plugin_key` and
  `operation_key`; execution is delegated through `QQBOT_PLUGIN_EXECUTION_PORT`.
- A subscription owns one canonical active source/config key; soft deletion
  clears that unique key so historical rows remain available.
- A live publish binding links one account and subscription to one compatible
  template. Any live binding prevents its template from being deleted.
- Binding `active_key` uniquely identifies account/subscription ownership;
  target `active_key` uniquely identifies binding/type/target ownership.
- Event `event_id` is globally unique. Delivery uniqueness on
  `(message_event_id, publish_target_id)` makes fan-out idempotent.
- Event and delivery dispatch/lease indexes support durable worker claims,
  retries, lease recovery, and source-resource supersession ordering.

Verification SQL:

```sql
SELECT COUNT(*) FROM qqbot_account WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_command WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_account_ability WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_message_subscription WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_message_template WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_message_publish_binding WHERE is_deleted = 0;
SELECT COUNT(*) FROM qqbot_message_publish_target WHERE is_deleted = 0;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'qqbot_message_subscription',
    'qqbot_message_template',
    'qqbot_message_publish_binding',
    'qqbot_message_publish_target',
    'qqbot_message_event',
    'qqbot_message_delivery'
  )
ORDER BY table_name;

SELECT table_name, index_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN (
    'qqbot_message_subscription',
    'qqbot_message_template',
    'qqbot_message_publish_binding',
    'qqbot_message_publish_target',
    'qqbot_message_event',
    'qqbot_message_delivery'
  )
ORDER BY table_name, index_name;
```
