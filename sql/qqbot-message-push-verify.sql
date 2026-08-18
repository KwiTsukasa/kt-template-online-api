-- 消息管理协议内核及 QQBot、站内信订阅者部署校验。

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'message_subscription',
    'message_template',
    'message_subscription_template',
    'message_event',
    'qqbot_message_publish_binding',
    'qqbot_message_publish_target',
    'qqbot_message_delivery',
    'station_notice_message_binding'
  )
ORDER BY table_name;

WITH required_index AS (
  SELECT 'message_subscription' AS table_name, 'PRIMARY' AS index_name, 0 AS non_unique, 1 AS seq_in_index, 'id' AS column_name
  UNION ALL SELECT 'message_subscription', 'uk_message_subscription_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'message_template', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'message_subscription_template', 'PRIMARY', 0, 1, 'subscription_id'
  UNION ALL SELECT 'message_subscription_template', 'PRIMARY', 0, 2, 'template_id'
  UNION ALL SELECT 'message_subscription_template', 'uk_message_subscription_template_order', 0, 1, 'subscription_id'
  UNION ALL SELECT 'message_subscription_template', 'uk_message_subscription_template_order', 0, 2, 'sort_order'
  UNION ALL SELECT 'message_event', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'message_event', 'uk_message_event_event_id', 0, 1, 'event_id'
  UNION ALL SELECT 'message_event', 'idx_message_event_dispatch', 1, 1, 'fanout_status'
  UNION ALL SELECT 'message_event', 'idx_message_event_dispatch', 1, 2, 'next_fanout_at'
  UNION ALL SELECT 'message_event', 'idx_message_event_lease', 1, 1, 'fanout_lease_until'
  UNION ALL SELECT 'message_event', 'idx_message_event_source_resource_order', 1, 1, 'source_key'
  UNION ALL SELECT 'message_event', 'idx_message_event_source_resource_order', 1, 2, 'resource_key'
  UNION ALL SELECT 'message_event', 'idx_message_event_source_resource_order', 1, 3, 'occurred_at'
  UNION ALL SELECT 'message_event', 'idx_message_event_source_resource_order', 1, 4, 'id'
  UNION ALL SELECT 'qqbot_message_publish_binding', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_publish_binding', 'uk_qqbot_message_publish_binding_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'qqbot_message_publish_target', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_publish_target', 'uk_qqbot_message_publish_target_active_key', 0, 1, 'active_key'
  UNION ALL SELECT 'qqbot_message_delivery', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target_template', 0, 1, 'message_event_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target_template', 0, 2, 'publish_target_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'uk_qqbot_message_delivery_event_target_template', 0, 3, 'template_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', 1, 1, 'status'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_dispatch', 1, 2, 'next_attempt_at'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_lease', 1, 1, 'processing_lease_until'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_history', 1, 1, 'subscription_id'
  UNION ALL SELECT 'qqbot_message_delivery', 'idx_qqbot_message_delivery_history', 1, 2, 'message_event_id'
  UNION ALL SELECT 'station_notice_message_binding', 'PRIMARY', 0, 1, 'id'
  UNION ALL SELECT 'station_notice_message_binding', 'uk_station_notice_message_binding_active_key', 0, 1, 'active_key'
),
actual_index AS (
  SELECT table_name, index_name, non_unique, seq_in_index, column_name
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
)
SELECT
  'message_management_required_indexes' AS check_name,
  COUNT(*) AS expected_column_count,
  COUNT(actual_index.index_name) AS matched_column_count,
  COUNT(*) - COUNT(actual_index.index_name) AS missing_column_count
FROM required_index
LEFT JOIN actual_index
  ON actual_index.table_name = required_index.table_name
  AND actual_index.index_name = required_index.index_name
  AND actual_index.non_unique = required_index.non_unique
  AND actual_index.seq_in_index = required_index.seq_in_index
  AND BINARY actual_index.column_name = BINARY required_index.column_name;

SELECT 'message_subscription_protocol_columns' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'message_subscription'
  AND column_name IN (
    'subscriber_key',
    'template_binding_digest',
    'source_config',
    'source_config_digest'
  );

SELECT 'message_subscription_forbidden_source_column' AS check_name, COUNT(*) AS invalid_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'message_subscription'
  AND column_name = 'source_key';

SELECT 'qqbot_binding_forbidden_template_column' AS check_name, COUNT(*) AS invalid_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_message_publish_binding'
  AND column_name = 'template_id';

SELECT 'message_subscription_without_template' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT subscription.id
  FROM message_subscription subscription
  LEFT JOIN message_subscription_template binding
    ON binding.subscription_id = subscription.id
  WHERE subscription.is_deleted = 0
  GROUP BY subscription.id
  HAVING COUNT(binding.template_id) = 0
) missing_template;

SELECT 'message_subscription_mixed_source' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT binding.subscription_id
  FROM message_subscription_template binding
  JOIN message_template template ON template.id = binding.template_id
  GROUP BY binding.subscription_id
  HAVING COUNT(DISTINCT template.source_key) <> 1
) mixed_source;

SELECT 'qqbot_delivery_duplicate_event_target_template' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT message_event_id, publish_target_id, template_id
  FROM qqbot_message_delivery
  GROUP BY message_event_id, publish_target_id, template_id
  HAVING COUNT(*) > 1
) duplicate_delivery;

SELECT 'seed_message_template' AS check_name, COUNT(*) AS matched_rows
FROM message_template
WHERE id IN (2041700000000200601, 2041700000000200602)
  AND enabled = 1
  AND is_deleted = 0;

WITH expected_menu AS (
  SELECT 2041700000000100420 AS id, 0 AS pid, 'MessageManagement' AS name, NULL AS auth_code
  UNION ALL SELECT 2041700000000100414, 2041700000000100420, 'MessageManagementTemplate', 'MessageManagement:Template:List'
  UNION ALL SELECT 2041700000000100413, 2041700000000100420, 'MessageManagementSubscription', 'MessageManagement:Subscription:List'
  UNION ALL SELECT 2041700000000100423, 2041700000000100420, 'MessageManagementStationNoticeSubscriber', 'MessageManagement:Push:List'
  UNION ALL SELECT 2041700000000120461, 2041700000000100413, 'MessageManagementSubscriptionList', 'MessageManagement:Subscription:List'
  UNION ALL SELECT 2041700000000120462, 2041700000000100413, 'MessageManagementSubscriptionCreate', 'MessageManagement:Subscription:Create'
  UNION ALL SELECT 2041700000000120463, 2041700000000100413, 'MessageManagementSubscriptionUpdate', 'MessageManagement:Subscription:Update'
  UNION ALL SELECT 2041700000000120464, 2041700000000100413, 'MessageManagementSubscriptionDelete', 'MessageManagement:Subscription:Delete'
  UNION ALL SELECT 2041700000000120465, 2041700000000100413, 'MessageManagementSubscriptionToggle', 'MessageManagement:Subscription:Toggle'
  UNION ALL SELECT 2041700000000120471, 2041700000000100414, 'MessageManagementTemplateList', 'MessageManagement:Template:List'
  UNION ALL SELECT 2041700000000120472, 2041700000000100414, 'MessageManagementTemplateCreate', 'MessageManagement:Template:Create'
  UNION ALL SELECT 2041700000000120473, 2041700000000100414, 'MessageManagementTemplateUpdate', 'MessageManagement:Template:Update'
  UNION ALL SELECT 2041700000000120474, 2041700000000100414, 'MessageManagementTemplateDelete', 'MessageManagement:Template:Delete'
  UNION ALL SELECT 2041700000000120475, 2041700000000100414, 'MessageManagementTemplateToggle', 'MessageManagement:Template:Toggle'
  UNION ALL SELECT 2041700000000120476, 2041700000000100414, 'MessageManagementTemplatePreview', 'MessageManagement:Template:Preview'
  UNION ALL SELECT 2041700000000120491, 2041700000000100423, 'MessageManagementPushList', 'MessageManagement:Push:List'
  UNION ALL SELECT 2041700000000120492, 2041700000000100423, 'MessageManagementPushCreate', 'MessageManagement:Push:Create'
  UNION ALL SELECT 2041700000000120493, 2041700000000100423, 'MessageManagementPushUpdate', 'MessageManagement:Push:Update'
  UNION ALL SELECT 2041700000000120494, 2041700000000100423, 'MessageManagementPushDelete', 'MessageManagement:Push:Delete'
  UNION ALL SELECT 2041700000000120495, 2041700000000100423, 'MessageManagementPushToggle', 'MessageManagement:Push:Toggle'
  UNION ALL SELECT 2041700000000120481, 2041700000000100410, 'QqBotAccountMessagePushList', 'QqBot:Account:MessagePush:List'
  UNION ALL SELECT 2041700000000120482, 2041700000000100410, 'QqBotAccountMessagePushCreate', 'QqBot:Account:MessagePush:Create'
  UNION ALL SELECT 2041700000000120483, 2041700000000100410, 'QqBotAccountMessagePushUpdate', 'QqBot:Account:MessagePush:Update'
  UNION ALL SELECT 2041700000000120484, 2041700000000100410, 'QqBotAccountMessagePushDelete', 'QqBot:Account:MessagePush:Delete'
  UNION ALL SELECT 2041700000000120485, 2041700000000100410, 'QqBotAccountMessagePushToggle', 'QqBot:Account:MessagePush:Toggle'
)
SELECT 'seed_message_management_menu_mismatch' AS check_name, COUNT(*) AS invalid_rows
FROM expected_menu expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
WHERE actual.id IS NULL
   OR actual.pid <> expected.pid
   OR NOT (BINARY actual.name <=> BINARY expected.name)
   OR NOT (BINARY actual.auth_code <=> BINARY expected.auth_code)
   OR actual.status <> 1
   OR actual.is_deleted <> 0;

WITH expected_menu AS (
  SELECT 2041700000000100420 AS id UNION ALL SELECT 2041700000000100414 UNION ALL SELECT 2041700000000100413
  UNION ALL SELECT 2041700000000100423 UNION ALL SELECT 2041700000000120461 UNION ALL SELECT 2041700000000120462
  UNION ALL SELECT 2041700000000120463 UNION ALL SELECT 2041700000000120464 UNION ALL SELECT 2041700000000120465
  UNION ALL SELECT 2041700000000120471 UNION ALL SELECT 2041700000000120472 UNION ALL SELECT 2041700000000120473
  UNION ALL SELECT 2041700000000120474 UNION ALL SELECT 2041700000000120475 UNION ALL SELECT 2041700000000120476
  UNION ALL SELECT 2041700000000120491 UNION ALL SELECT 2041700000000120492 UNION ALL SELECT 2041700000000120493
  UNION ALL SELECT 2041700000000120494 UNION ALL SELECT 2041700000000120495 UNION ALL SELECT 2041700000000120481
  UNION ALL SELECT 2041700000000120482 UNION ALL SELECT 2041700000000120483 UNION ALL SELECT 2041700000000120484
  UNION ALL SELECT 2041700000000120485
)
SELECT 'seed_message_management_role_grant_missing' AS check_name, COUNT(*) AS missing_rows
FROM admin_role role
CROSS JOIN expected_menu expected
LEFT JOIN admin_role_menu role_menu
  ON role_menu.role_id = role.id
  AND role_menu.menu_id = expected.id
WHERE role.role_code IN ('super', 'admin')
  AND role.status = 1
  AND role.is_deleted = 0
  AND role_menu.menu_id IS NULL;
