# Bot Core and Message Subscriber Schema

Bot Core owns only QQ account, command, rule, permission, conversation,
configuration, deduplication, inbound message, and send-log persistence. Generic
message sources, templates, subscriptions, events, rendering, and fan-out belong
to the independent Message Management module. Bot and station notices are
subscriber adapters of that protocol; neither is part of the protocol core.

## Ownership

Bot Core tables:

- `bot_account`
- `bot_account_ability`
- `bot_command`
- `bot_command_log`
- `bot_config`
- `bot_conversation`
- `bot_dedupe`
- `bot_message`
- `bot_allowlist`
- `bot_blocklist`
- `bot_rule`
- `bot_send_log`

Message Management tables:

- `message_template`
- `message_subscription`
- `message_subscription_template`
- `message_event`

Subscriber-owned tables:

- Bot: `bot_message_publish_binding`, `bot_message_publish_target`,
  `bot_message_delivery`
- Station notice: `station_notice_message_binding`; materialized notices remain
  in the existing `admin_notice` table

## Protocol direction

1. Message Management registers source adapters and normalizes each source event.
2. Every template binds exactly one `source_key`.
3. Every subscription binds one subscriber and a non-empty ordered set of
   templates. All templates in the set must belong to the same source.
4. A matching event is resolved and rendered once by Message Management. The
   unified subscriber envelope contains every rendered template in `templates[]`
   in subscription order.
5. Message Management invokes only the selected subscriber adapter once. The
   subscriber decides how those rendered templates become concrete deliveries.

The current Bot adapter creates one durable delivery per rendered template and
target. The station-notice adapter materializes one station notice per rendered
template. Concrete adapters can change that delivery policy without importing
their concepts into Message Management.

Source adapters must be registered only by Message Management. Bot and station
notice code must depend on the unified subscriber contract and must not call a
message source adapter directly. Compatibility HTTP routes, target discovery,
recipient configuration, and delivery state remain owned by the concrete
subscriber adapter.

## Integrity and lifecycle

- `message_subscription.template_binding_digest` identifies the ordered template
  set; `source_config_digest` identifies normalized source configuration.
- A live subscription active key combines subscriber, template set, and source
  configuration. Soft deletion clears that key while retaining history.
- Bot binding `active_key` identifies account/subscription ownership; target
  `active_key` identifies binding/type/target ownership.
- `message_event.event_id` is globally unique. Event readiness, including DDNS
  deferral, is handled before the subscriber is invoked.
- Bot delivery uniqueness is
  `(message_event_id, publish_target_id, template_id)`, so every template in one
  unified envelope can be delivered exactly once per database target claim.
- Event states are `accepted`, `processing`, `deferred`, `retry`, `completed`, and
  `failed`. Bot delivery states are `pending`, `processing`, `retry`, `success`,
  `failed`, `superseded`, and `cancelled`.
- Terminal events, subscriber deliveries, and send-log links remain audit
  history. Application rollback does not physically delete them.

## Migration and verification

Existing environments apply only `sql/bot-message-push-init.sql`, then run the
read-only `sql/bot-message-push-verify.sql`. The incremental migration copies
legacy Bot templates/events into Message Management. To preserve old account
behavior, a legacy subscription used with different templates is split by
`(legacy subscription, template)` before the private binding `template_id` column
is removed; it is never migrated as a template union delivered to every account.

Before migration, take a transaction-consistent backup of the three legacy
protocol tables, every already-present `message_*` protocol table, the three
Bot subscriber tables, the station binding table when present, and relevant
`admin_menu` / `admin_role_menu` rows. Do not use the broad historical
`sql/bot-init.sql` as the production migration entry.

Useful count-only checks:

```sql
SELECT COUNT(*) FROM message_template WHERE is_deleted = 0;
SELECT COUNT(*) FROM message_subscription WHERE is_deleted = 0;
SELECT COUNT(*) FROM message_subscription_template;
SELECT COUNT(*) FROM message_event;
SELECT COUNT(*) FROM bot_message_publish_binding WHERE is_deleted = 0;
SELECT COUNT(*) FROM bot_message_publish_target WHERE is_deleted = 0;
SELECT COUNT(*) FROM station_notice_message_binding WHERE is_deleted = 0;

SELECT fanout_status, COUNT(*) AS event_count
FROM message_event
GROUP BY fanout_status
ORDER BY fanout_status;

SELECT status, COUNT(*) AS delivery_count
FROM bot_message_delivery
GROUP BY status
ORDER BY status;

SELECT COUNT(*) AS duplicate_event_target_template_groups
FROM (
  SELECT message_event_id, publish_target_id, template_id
  FROM bot_message_delivery
  GROUP BY message_event_id, publish_target_id, template_id
  HAVING COUNT(*) > 1
) AS duplicate_deliveries;
```

Verification output must contain only counts or ID/index summaries. Never print
raw event payloads, rendered messages, target IDs, credentials, provider objects,
or production values. Release evidence records database, HTTP, Admin page,
source-event, and explicitly authorized subscriber-delivery gates separately;
deployment success alone is not functional delivery evidence.
