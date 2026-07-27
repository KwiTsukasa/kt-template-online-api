-- QQBot 系统消息推送生产增量迁移。
-- 仅创建本功能六表、默认模板、菜单和角色授权，不执行历史 QQBot 迁移。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS qqbot_message_subscription (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  source_config JSON NOT NULL,
  source_config_digest CHAR(64) NOT NULL,
  active_key VARCHAR(255) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(500) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_qqbot_message_subscription_active_key (active_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_template (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(500) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_publish_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  subscription_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  self_id VARCHAR(64) NOT NULL,
  template_id BIGINT NOT NULL,
  active_key VARCHAR(255) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_qqbot_message_publish_binding_active_key (active_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_publish_target (
  id BIGINT NOT NULL PRIMARY KEY,
  binding_id BIGINT NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  target_name VARCHAR(120) NULL,
  active_key VARCHAR(300) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_qqbot_message_publish_target_active_key (active_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_event (
  id BIGINT NOT NULL PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  resource_key VARCHAR(128) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  payload JSON NOT NULL,
  fanout_status VARCHAR(32) NOT NULL DEFAULT 'accepted',
  fanout_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_fanout_at DATETIME(6) NULL,
  fanout_lease_until DATETIME(6) NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(500) NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_qqbot_message_event_event_id (event_id),
  KEY idx_qqbot_message_event_dispatch (fanout_status, next_fanout_at),
  KEY idx_qqbot_message_event_lease (fanout_lease_until),
  KEY idx_qqbot_message_event_source_resource_order (source_key, resource_key, occurred_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_delivery (
  id BIGINT NOT NULL PRIMARY KEY,
  message_event_id BIGINT NOT NULL,
  publish_target_id BIGINT NOT NULL,
  binding_id BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  self_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  template_id BIGINT NOT NULL,
  template_content TEXT NOT NULL,
  variable_snapshot JSON NOT NULL,
  rendered_message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NULL,
  processing_lease_until DATETIME(6) NULL,
  send_log_id BIGINT NULL,
  last_error_code VARCHAR(64) NULL,
  last_error_message VARCHAR(500) NULL,
  expires_at DATETIME(6) NOT NULL,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_qqbot_message_delivery_event_target (message_event_id, publish_target_id),
  KEY idx_qqbot_message_delivery_dispatch (status, next_attempt_at),
  KEY idx_qqbot_message_delivery_lease (processing_lease_until),
  KEY idx_qqbot_message_delivery_history (subscription_id, message_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO qqbot_message_template (id, name, source_key, content, enabled, remark, is_deleted)
SELECT
  2041700000000200601,
  'STUN 映射端口变更默认模板',
  'network.stun.mapping-port-changed',
  '当前STUN的端口已变更为${{endpoint}}',
  1,
  '系统默认模板',
  0
WHERE NOT EXISTS (
  SELECT 1
  FROM qqbot_message_template
  WHERE source_key = 'network.stun.mapping-port-changed'
    AND name = 'STUN 映射端口变更默认模板'
    AND is_deleted = 0
);

INSERT IGNORE INTO qqbot_message_template (id, name, source_key, content, enabled, remark, is_deleted)
SELECT
  2041700000000200602,
  'TCP NATMap 端点变更默认模板',
  'network.tcp.natmap-endpoint-changed',
  '当前 TCP NATMap 端点已变更为 ${{endpoint}}',
  1,
  '系统默认模板',
  0
WHERE NOT EXISTS (
  SELECT 1
  FROM qqbot_message_template
  WHERE source_key = 'network.tcp.natmap-endpoint-changed'
    AND name = 'TCP NATMap 端点变更默认模板'
    AND is_deleted = 0
);

INSERT INTO admin_menu (
  id,
  pid,
  name,
  path,
  component,
  redirect,
  auth_code,
  type,
  meta,
  status,
  sort
) VALUES
  (2041700000000100413,2041700000000100400,'QqBotMessageSubscription','/qqbot/message-subscription','/qqbot/message-subscription/list',NULL,'QqBot:MessageSubscription:List','menu','{"icon":"lucide:bell-ring","title":"消息订阅"}',1,10),
  (2041700000000100414,2041700000000100400,'QqBotMessageTemplate','/qqbot/message-template','/qqbot/message-template/list',NULL,'QqBot:MessageTemplate:List','menu','{"icon":"lucide:message-square-plus","title":"消息模板"}',1,11),
  (2041700000000120461,2041700000000100413,'QqBotMessageSubscriptionList',NULL,NULL,NULL,'QqBot:MessageSubscription:List','button','{"title":"common.list"}',1,0),
  (2041700000000120462,2041700000000100413,'QqBotMessageSubscriptionCreate',NULL,NULL,NULL,'QqBot:MessageSubscription:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120463,2041700000000100413,'QqBotMessageSubscriptionUpdate',NULL,NULL,NULL,'QqBot:MessageSubscription:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120464,2041700000000100413,'QqBotMessageSubscriptionDelete',NULL,NULL,NULL,'QqBot:MessageSubscription:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120465,2041700000000100413,'QqBotMessageSubscriptionToggle',NULL,NULL,NULL,'QqBot:MessageSubscription:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120471,2041700000000100414,'QqBotMessageTemplateList',NULL,NULL,NULL,'QqBot:MessageTemplate:List','button','{"title":"common.list"}',1,0),
  (2041700000000120472,2041700000000100414,'QqBotMessageTemplateCreate',NULL,NULL,NULL,'QqBot:MessageTemplate:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120473,2041700000000100414,'QqBotMessageTemplateUpdate',NULL,NULL,NULL,'QqBot:MessageTemplate:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120474,2041700000000100414,'QqBotMessageTemplateDelete',NULL,NULL,NULL,'QqBot:MessageTemplate:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120475,2041700000000100414,'QqBotMessageTemplateToggle',NULL,NULL,NULL,'QqBot:MessageTemplate:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120476,2041700000000100414,'QqBotMessageTemplatePreview',NULL,NULL,NULL,'QqBot:MessageTemplate:Preview','button','{"title":"预览"}',1,0),
  (2041700000000120481,2041700000000100410,'QqBotAccountMessagePushList',NULL,NULL,NULL,'QqBot:Account:MessagePush:List','button','{"title":"common.list"}',1,0),
  (2041700000000120482,2041700000000100410,'QqBotAccountMessagePushCreate',NULL,NULL,NULL,'QqBot:Account:MessagePush:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120483,2041700000000100410,'QqBotAccountMessagePushUpdate',NULL,NULL,NULL,'QqBot:Account:MessagePush:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120484,2041700000000100410,'QqBotAccountMessagePushDelete',NULL,NULL,NULL,'QqBot:Account:MessagePush:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120485,2041700000000100410,'QqBotAccountMessagePushToggle',NULL,NULL,NULL,'QqBot:Account:MessagePush:Toggle','button','{"title":"启停"}',1,0)
ON DUPLICATE KEY UPDATE
  pid = VALUES(pid),
  name = VALUES(name),
  path = VALUES(path),
  component = VALUES(component),
  redirect = VALUES(redirect),
  auth_code = VALUES(auth_code),
  type = VALUES(type),
  meta = VALUES(meta),
  status = VALUES(status),
  sort = VALUES(sort),
  is_deleted = 0;

INSERT IGNORE INTO admin_role_menu (role_id, menu_id)
SELECT role.id, menu.id
FROM admin_role role
CROSS JOIN admin_menu menu
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
  AND menu.is_deleted = 0;
