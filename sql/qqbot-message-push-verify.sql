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

WITH required_index AS (
  SELECT 'qqbot_message_subscription' AS table_name, 'PRIMARY' AS index_name, 0 AS non_unique, 1 AS seq_in_index, 'id' AS column_name
  UNION ALL SELECT 'qqbot_message_subscription', 'uk_qqbot_message_subscription_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'qqbot_message_template', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_publish_binding', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_publish_binding', 'uk_qqbot_message_publish_binding_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'qqbot_message_publish_target', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_publish_target', 'uk_qqbot_message_publish_target_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'qqbot_message_event', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_event', 'uk_qqbot_message_event_event_id', 0, 1, 'event_id'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_dispatch', 1, 1, 'fanout_status'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_dispatch', 1, 2, 'next_fanout_at'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_lease', 1, 1, 'fanout_lease_until'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', 1, 1, 'source_key'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', 1, 2, 'resource_key'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', 1, 3, 'occurred_at'
  UNION ALL SELECT 'qqbot_message_event', 'idx_qqbot_message_event_source_resource_order', 1, 4, 'id'
  UNION ALL SELECT 'qqbot_message_delivery', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target', 0, 1, 'message_event_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target', 0, 2, 'publish_target_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', 1, 1, 'status'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', 1, 2, 'next_attempt_at'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_lease', 1, 1, 'processing_lease_until'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_history', 1, 1, 'subscription_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_history', 1, 2, 'message_event_id'
),
actual_index AS (
  SELECT table_name, index_name, non_unique, seq_in_index, column_name
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
)
SELECT
  'qqbot_message_push_required_indexes' AS check_name,
  COUNT(DISTINCT CONCAT(required_index.table_name, '/', required_index.index_name)) AS expected_index_count,
  COUNT(*) AS expected_column_count,
  COUNT(actual_index.index_name) AS matched_column_count,
  COUNT(*) - COUNT(actual_index.index_name) AS missing_column_count,
  (
    SELECT COUNT(*)
    FROM actual_index unexpected
    LEFT JOIN required_index expected
      ON expected.table_name = unexpected.table_name
      AND expected.index_name = unexpected.index_name
      AND expected.non_unique = unexpected.non_unique
      AND expected.seq_in_index = unexpected.seq_in_index
      AND BINARY expected.column_name = BINARY unexpected.column_name
    WHERE expected.table_name IS NULL
  ) AS unexpected_column_count
FROM required_index
LEFT JOIN actual_index
  ON actual_index.table_name = required_index.table_name
  AND actual_index.index_name = required_index.index_name
  AND actual_index.non_unique = required_index.non_unique
  AND actual_index.seq_in_index = required_index.seq_in_index
  AND BINARY actual_index.column_name = BINARY required_index.column_name;

SELECT 'seed_qqbot_message_template' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_message_template
WHERE id = 2041700000000200601
  AND BINARY name = BINARY 'STUN 映射端口变更默认模板'
  AND BINARY source_key = BINARY 'network.stun.mapping-port-changed'
  AND BINARY content = BINARY '当前STUN的端口已变更为${{endpoint}}'
  AND enabled = 1
  AND is_deleted = 0;

SELECT 'seed_qqbot_tcp_natmap_message_template' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_message_template
WHERE id = 2041700000000200602
  AND BINARY name = BINARY 'TCP NATMap 端点变更默认模板'
  AND BINARY source_key = BINARY 'network.tcp.natmap-endpoint-changed'
  AND BINARY content = BINARY '当前 TCP NATMap 端点已变更为 ${{endpoint}}'
  AND enabled = 1
  AND is_deleted = 0;

SELECT 'seed_qqbot_message_push_menu' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE id IN (
  2041700000000100413,
  2041700000000100414,
  2041700000000120461,
  2041700000000120462,
  2041700000000120463,
  2041700000000120464,
  2041700000000120465,
  2041700000000120471,
  2041700000000120472,
  2041700000000120473,
  2041700000000120474,
  2041700000000120475,
  2041700000000120476,
  2041700000000120481,
  2041700000000120482,
  2041700000000120483,
  2041700000000120484,
  2041700000000120485
)
  AND status = 1
  AND is_deleted = 0;

WITH expected_menu AS (
  SELECT 2041700000000100413 AS id, 2041700000000100400 AS pid, 'QqBotMessageSubscription' AS name, 'QqBot:MessageSubscription:List' AS auth_code, 10 AS sort
  UNION ALL SELECT 2041700000000100414, 2041700000000100400, 'QqBotMessageTemplate', 'QqBot:MessageTemplate:List', 11
  UNION ALL SELECT 2041700000000120461, 2041700000000100413, 'QqBotMessageSubscriptionList', 'QqBot:MessageSubscription:List', 0
  UNION ALL SELECT 2041700000000120462, 2041700000000100413, 'QqBotMessageSubscriptionCreate', 'QqBot:MessageSubscription:Create', 0
  UNION ALL SELECT 2041700000000120463, 2041700000000100413, 'QqBotMessageSubscriptionUpdate', 'QqBot:MessageSubscription:Update', 0
  UNION ALL SELECT 2041700000000120464, 2041700000000100413, 'QqBotMessageSubscriptionDelete', 'QqBot:MessageSubscription:Delete', 0
  UNION ALL SELECT 2041700000000120465, 2041700000000100413, 'QqBotMessageSubscriptionToggle', 'QqBot:MessageSubscription:Toggle', 0
  UNION ALL SELECT 2041700000000120471, 2041700000000100414, 'QqBotMessageTemplateList', 'QqBot:MessageTemplate:List', 0
  UNION ALL SELECT 2041700000000120472, 2041700000000100414, 'QqBotMessageTemplateCreate', 'QqBot:MessageTemplate:Create', 0
  UNION ALL SELECT 2041700000000120473, 2041700000000100414, 'QqBotMessageTemplateUpdate', 'QqBot:MessageTemplate:Update', 0
  UNION ALL SELECT 2041700000000120474, 2041700000000100414, 'QqBotMessageTemplateDelete', 'QqBot:MessageTemplate:Delete', 0
  UNION ALL SELECT 2041700000000120475, 2041700000000100414, 'QqBotMessageTemplateToggle', 'QqBot:MessageTemplate:Toggle', 0
  UNION ALL SELECT 2041700000000120476, 2041700000000100414, 'QqBotMessageTemplatePreview', 'QqBot:MessageTemplate:Preview', 0
  UNION ALL SELECT 2041700000000120481, 2041700000000100410, 'QqBotAccountMessagePushList', 'QqBot:Account:MessagePush:List', 0
  UNION ALL SELECT 2041700000000120482, 2041700000000100410, 'QqBotAccountMessagePushCreate', 'QqBot:Account:MessagePush:Create', 0
  UNION ALL SELECT 2041700000000120483, 2041700000000100410, 'QqBotAccountMessagePushUpdate', 'QqBot:Account:MessagePush:Update', 0
  UNION ALL SELECT 2041700000000120484, 2041700000000100410, 'QqBotAccountMessagePushDelete', 'QqBot:Account:MessagePush:Delete', 0
  UNION ALL SELECT 2041700000000120485, 2041700000000100410, 'QqBotAccountMessagePushToggle', 'QqBot:Account:MessagePush:Toggle', 0
)
SELECT 'seed_qqbot_message_push_menu_mismatch' AS check_name, COUNT(*) AS invalid_rows
FROM expected_menu expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
WHERE actual.id IS NULL
   OR NOT (BINARY actual.name <=> BINARY expected.name)
   OR NOT (BINARY actual.auth_code <=> BINARY expected.auth_code)
   OR actual.pid <> expected.pid
   OR actual.sort <> expected.sort
   OR actual.status <> 1
   OR actual.is_deleted <> 0;

SELECT 'seed_qqbot_message_push_page_menu' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE (
    id = 2041700000000100413
    AND pid = 2041700000000100400
    AND BINARY name = BINARY 'QqBotMessageSubscription'
    AND BINARY path = BINARY '/qqbot/message-subscription'
    AND BINARY component = BINARY '/qqbot/message-subscription/list'
    AND BINARY auth_code = BINARY 'QqBot:MessageSubscription:List'
    AND BINARY JSON_UNQUOTE(JSON_EXTRACT(meta, '$.title')) = BINARY '消息订阅'
    AND sort = 10
  )
  OR (
    id = 2041700000000100414
    AND pid = 2041700000000100400
    AND BINARY name = BINARY 'QqBotMessageTemplate'
    AND BINARY path = BINARY '/qqbot/message-template'
    AND BINARY component = BINARY '/qqbot/message-template/list'
    AND BINARY auth_code = BINARY 'QqBot:MessageTemplate:List'
    AND BINARY JSON_UNQUOTE(JSON_EXTRACT(meta, '$.title')) = BINARY '消息模板'
    AND sort = 11
  );

SELECT 'seed_qqbot_message_push_role_grant_missing' AS check_name, COUNT(*) AS missing_rows
FROM admin_role role
CROSS JOIN admin_menu menu
LEFT JOIN admin_role_menu role_menu
  ON role_menu.role_id = role.id
  AND role_menu.menu_id = menu.id
WHERE role.role_code IN ('super', 'admin')
  AND role.status = 1
  AND role.is_deleted = 0
  AND menu.id IN (
    2041700000000100413,
    2041700000000100414,
    2041700000000120461,
    2041700000000120462,
    2041700000000120463,
    2041700000000120464,
    2041700000000120465,
    2041700000000120471,
    2041700000000120472,
    2041700000000120473,
    2041700000000120474,
    2041700000000120475,
    2041700000000120476,
    2041700000000120481,
    2041700000000120482,
    2041700000000120483,
    2041700000000120484,
    2041700000000120485
  )
  AND menu.status = 1
  AND menu.is_deleted = 0
  AND role_menu.menu_id IS NULL;

SELECT 'duplicate_event_id_groups' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT event_id
  FROM qqbot_message_event
  GROUP BY event_id
  HAVING COUNT(*) > 1
) duplicate_events;

SELECT 'duplicate_event_target_groups' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT message_event_id, publish_target_id
  FROM qqbot_message_delivery
  GROUP BY message_event_id, publish_target_id
  HAVING COUNT(*) > 1
) duplicate_deliveries;
