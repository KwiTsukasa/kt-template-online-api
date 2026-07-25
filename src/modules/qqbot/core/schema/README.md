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

Worker status relationships:

- Events in `accepted` or due `retry` are claimable; an expired
  `processing` lease is recoverable. `completed` and `failed` are terminal.
- Deliveries in due `pending`, `retry`, or `waiting_ddns` are claimable; an
  expired `processing` lease is recoverable. `success`, `failed`,
  `superseded`, and `cancelled` are terminal.
- A selected DDNS record advances relevant `waiting_ddns` work only after its
  `synced` state and `applied_address` commit. The immediate wake is backed by
  the persistent 60-second recheck.
- Terminal events, deliveries, and their send-log links remain history; normal
  rollback does not physically delete them.

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

SELECT fanout_status, COUNT(*) AS event_count
FROM qqbot_message_event
GROUP BY fanout_status
ORDER BY fanout_status;

SELECT status, COUNT(*) AS delivery_count
FROM qqbot_message_delivery
GROUP BY status
ORDER BY status;

SELECT COUNT(*) AS duplicate_event_id_groups
FROM (
  SELECT event_id
  FROM qqbot_message_event
  GROUP BY event_id
  HAVING COUNT(*) > 1
) AS duplicate_events;

SELECT COUNT(*) AS duplicate_event_target_groups
FROM (
  SELECT message_event_id, publish_target_id
  FROM qqbot_message_delivery
  GROUP BY message_event_id, publish_target_id
  HAVING COUNT(*) > 1
) AS duplicate_deliveries;

SELECT COUNT(*) AS invalid_success_send_log_links
FROM qqbot_message_delivery AS delivery
LEFT JOIN qqbot_send_log AS send_log
  ON send_log.id = delivery.send_log_id
WHERE delivery.status = 'success'
  AND (
    delivery.send_log_id IS NULL
    OR send_log.id IS NULL
    OR send_log.status <> 'success'
    OR send_log.self_id <> delivery.self_id
    OR send_log.target_type <> delivery.target_type
    OR send_log.target_id <> delivery.target_id
  );

SELECT 'event_due' AS summary, COUNT(*) AS item_count
FROM qqbot_message_event
WHERE fanout_status IN ('accepted', 'retry')
  AND (next_fanout_at IS NULL OR next_fanout_at <= NOW(6))
UNION ALL
SELECT 'event_expired_lease', COUNT(*)
FROM qqbot_message_event
WHERE fanout_status = 'processing'
  AND fanout_lease_until <= NOW(6)
UNION ALL
SELECT 'delivery_due', COUNT(*)
FROM qqbot_message_delivery
WHERE status IN ('pending', 'retry', 'waiting_ddns')
  AND next_attempt_at <= NOW(6)
UNION ALL
SELECT 'delivery_expired_lease', COUNT(*)
FROM qqbot_message_delivery
WHERE status = 'processing'
  AND processing_lease_until <= NOW(6);

SELECT 'active_bindings' AS summary, COUNT(*) AS item_count
FROM qqbot_message_publish_binding
WHERE enabled = 1
  AND is_deleted = 0
UNION ALL
SELECT 'unfinished_events', COUNT(*)
FROM qqbot_message_event
WHERE fanout_status IN ('accepted', 'processing', 'retry')
UNION ALL
SELECT 'unfinished_deliveries', COUNT(*)
FROM qqbot_message_delivery
WHERE status IN ('waiting_ddns', 'pending', 'processing', 'retry');
```

Before applying SQL, take a transaction-consistent backup of all six
`qqbot_message_*` push tables plus the relevant `admin_menu` and
`admin_role_menu` rows. Roll back by disabling publish bindings first, then
rolling back Admin and API while retaining events, deliveries, and send logs;
do not use `DROP TABLE` or history deletion as an application rollback.

Verification output must contain only counts or ID/index summaries. Never query
or print `payload`, `rendered_message`, `target_id`, credentials, provider
objects, or production values. The implementation and automated API evidence
exist, but real local CRUD, browser pages, database-backed Outbox/DDNS flow,
and authorized QQ delivery remain unverified because safe local prerequisites
are unavailable; this documentation change performed no push, deployment, or
production SQL.
