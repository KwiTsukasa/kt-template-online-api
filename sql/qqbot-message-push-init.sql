-- 消息管理协议内核与 QQBot、站内信订阅者生产增量初始化。
-- 通用模板、订阅、事件归消息管理；QQBot 与站内信仅保留各自投递配置。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS message_subscription (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  subscriber_key VARCHAR(64) NOT NULL,
  template_binding_digest CHAR(64) NOT NULL,
  source_config JSON NOT NULL,
  source_config_digest CHAR(64) NOT NULL,
  active_key VARCHAR(255) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(500) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_message_subscription_active_key (active_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS message_template (
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

CREATE TABLE IF NOT EXISTS message_subscription_template (
  subscription_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (subscription_id, template_id),
  UNIQUE KEY uk_message_subscription_template_order (subscription_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qqbot_message_publish_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  subscription_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  self_id VARCHAR(64) NOT NULL,
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

CREATE TABLE IF NOT EXISTS message_event (
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
  UNIQUE KEY uk_message_event_event_id (event_id),
  KEY idx_message_event_dispatch (fanout_status, next_fanout_at),
  KEY idx_message_event_lease (fanout_lease_until),
  KEY idx_message_event_source_resource_order (source_key, resource_key, occurred_at, id)
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
  UNIQUE KEY uk_qqbot_message_delivery_event_target_template (message_event_id, publish_target_id, template_id),
  KEY idx_qqbot_message_delivery_dispatch (status, next_attempt_at),
  KEY idx_qqbot_message_delivery_lease (processing_lease_until),
  KEY idx_qqbot_message_delivery_history (subscription_id, message_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_notice_message_binding (
  id BIGINT NOT NULL PRIMARY KEY,
  subscription_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  notify_role_code VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  active_key VARCHAR(255) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_station_notice_message_binding_active_key (active_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 兼容上一版 QQBot 私有消息表：先复制协议数据，再移除订阅者私有模板列。
SET @legacy_message_template_exists := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_message_template'
);
SET @migration_sql := IF(
  @legacy_message_template_exists = 1,
  'INSERT INTO message_template (id, name, source_key, content, enabled, remark, is_deleted, create_time, update_time)
   SELECT id, name, source_key, content, enabled, remark, is_deleted, create_time, update_time
   FROM qqbot_message_template
   ON DUPLICATE KEY UPDATE
     name = VALUES(name), source_key = VALUES(source_key), content = VALUES(content),
     enabled = VALUES(enabled), remark = VALUES(remark), is_deleted = VALUES(is_deleted),
     create_time = VALUES(create_time), update_time = VALUES(update_time)',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @legacy_message_event_exists := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_message_event'
);
SET @migration_sql := IF(
  @legacy_message_event_exists = 1,
  'INSERT INTO message_event (
     id, event_id, source_key, resource_key, occurred_at, payload, fanout_status,
     fanout_attempt_count, next_fanout_at, fanout_lease_until, last_error_code,
     last_error_message, create_time, update_time
   )
   SELECT
     id, event_id, source_key, resource_key, occurred_at, payload, fanout_status,
     fanout_attempt_count, next_fanout_at, fanout_lease_until, last_error_code,
     last_error_message, create_time, update_time
   FROM qqbot_message_event
   ON DUPLICATE KEY UPDATE
     event_id = VALUES(event_id), source_key = VALUES(source_key),
     resource_key = VALUES(resource_key), occurred_at = VALUES(occurred_at),
     payload = VALUES(payload), fanout_status = VALUES(fanout_status),
     fanout_attempt_count = VALUES(fanout_attempt_count),
     next_fanout_at = VALUES(next_fanout_at),
     fanout_lease_until = VALUES(fanout_lease_until),
     last_error_code = VALUES(last_error_code),
     last_error_message = VALUES(last_error_message),
     create_time = VALUES(create_time), update_time = VALUES(update_time)',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @legacy_subscription_ready := (
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'qqbot_message_subscription')
    +
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'qqbot_message_publish_binding'
       AND column_name = 'template_id')
);

-- 旧模型把模板放在 QQBot 账号绑定上。若同一旧订阅被不同账号选了不同模板，
-- 迁移时必须按“旧订阅 + 模板”拆成多个单模板订阅，不能把模板求并集后让账号多收消息。
DROP TEMPORARY TABLE IF EXISTS legacy_message_subscription_template_map;
CREATE TEMPORARY TABLE legacy_message_subscription_template_map (
  legacy_subscription_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  mapped_subscription_id BIGINT NOT NULL,
  PRIMARY KEY (legacy_subscription_id, template_id),
  UNIQUE KEY uk_legacy_message_subscription_template_mapped_id (mapped_subscription_id)
);

SET @migration_sql := IF(
  @legacy_subscription_ready = 2,
  'INSERT INTO legacy_message_subscription_template_map (
     legacy_subscription_id, template_id, mapped_subscription_id
   )
   SELECT
     ranked.subscription_id,
     ranked.template_id,
     CASE
       WHEN ranked.template_rank = 1 THEN ranked.subscription_id
       ELSE ranked.seed_binding_id
     END
   FROM (
     SELECT
       template_pair.subscription_id,
       template_pair.template_id,
       template_pair.seed_binding_id,
       ROW_NUMBER() OVER (
         PARTITION BY template_pair.subscription_id
         ORDER BY template_pair.template_id
       ) AS template_rank
     FROM (
       SELECT subscription_id, template_id, MIN(id) AS seed_binding_id
       FROM qqbot_message_publish_binding
       WHERE is_deleted = 0
       GROUP BY subscription_id, template_id
     ) template_pair
   ) ranked',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @migration_sql := IF(
  @legacy_subscription_ready = 2,
  'INSERT INTO message_subscription (
     id, name, subscriber_key, template_binding_digest, source_config,
     source_config_digest, active_key, enabled, remark, is_deleted,
     create_time, update_time
   )
   SELECT
     mapping.mapped_subscription_id,
     legacy.name,
     ''qqbot'',
     SHA2(CONCAT(''["'', CAST(mapping.template_id AS CHAR), ''"]''), 256),
     legacy.source_config,
     legacy.source_config_digest,
     CASE
       WHEN legacy.is_deleted = 1 THEN NULL
       ELSE CONCAT(
         ''qqbot:'',
         SHA2(CONCAT(''["'', CAST(mapping.template_id AS CHAR), ''"]''), 256),
         '':'',
         legacy.source_config_digest
       )
     END,
     legacy.enabled,
     legacy.remark,
     legacy.is_deleted,
     legacy.create_time,
     legacy.update_time
   FROM qqbot_message_subscription legacy
   JOIN legacy_message_subscription_template_map mapping
     ON mapping.legacy_subscription_id = legacy.id
   ON DUPLICATE KEY UPDATE
     name = VALUES(name), subscriber_key = VALUES(subscriber_key),
     template_binding_digest = VALUES(template_binding_digest),
     source_config = VALUES(source_config),
     source_config_digest = VALUES(source_config_digest),
     active_key = VALUES(active_key), enabled = VALUES(enabled),
     remark = VALUES(remark), is_deleted = VALUES(is_deleted),
     create_time = VALUES(create_time), update_time = VALUES(update_time)',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @migration_sql := IF(
  @legacy_subscription_ready = 2,
  'INSERT IGNORE INTO message_subscription_template (subscription_id, template_id, sort_order)
   SELECT
     mapping.mapped_subscription_id,
     mapping.template_id,
     0
   FROM legacy_message_subscription_template_map mapping',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

UPDATE qqbot_message_delivery delivery
JOIN legacy_message_subscription_template_map mapping
  ON mapping.legacy_subscription_id = delivery.subscription_id
  AND mapping.template_id = delivery.template_id
SET delivery.subscription_id = mapping.mapped_subscription_id;

SET @migration_sql := IF(
  @legacy_subscription_ready = 2,
  'UPDATE qqbot_message_publish_binding binding
   JOIN legacy_message_subscription_template_map mapping
     ON mapping.legacy_subscription_id = binding.subscription_id
     AND mapping.template_id = binding.template_id
   SET
     binding.subscription_id = mapping.mapped_subscription_id,
     binding.active_key = CASE
       WHEN binding.is_deleted = 1 THEN NULL
       ELSE CONCAT(binding.account_id, '':'', mapping.mapped_subscription_id)
     END',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @legacy_binding_template_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_message_publish_binding'
    AND column_name = 'template_id'
);
SET @migration_sql := IF(
  @legacy_binding_template_column_exists = 1,
  'ALTER TABLE qqbot_message_publish_binding DROP COLUMN template_id',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

DROP TEMPORARY TABLE legacy_message_subscription_template_map;

SET @legacy_delivery_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_message_delivery'
    AND index_name = 'uk_qqbot_message_delivery_event_target'
);
SET @migration_sql := IF(
  @legacy_delivery_index_exists > 0,
  'ALTER TABLE qqbot_message_delivery DROP INDEX uk_qqbot_message_delivery_event_target',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

SET @message_delivery_template_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_message_delivery'
    AND index_name = 'uk_qqbot_message_delivery_event_target_template'
);
SET @migration_sql := IF(
  @message_delivery_template_index_exists = 0,
  'ALTER TABLE qqbot_message_delivery
   ADD UNIQUE KEY uk_qqbot_message_delivery_event_target_template
     (message_event_id, publish_target_id, template_id)',
  'SELECT 1'
);
PREPARE message_migration FROM @migration_sql;
EXECUTE message_migration;
DEALLOCATE PREPARE message_migration;

INSERT IGNORE INTO message_template (id, name, source_key, content, enabled, remark, is_deleted)
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
  FROM message_template
  WHERE source_key = 'network.stun.mapping-port-changed'
    AND name = 'STUN 映射端口变更默认模板'
    AND is_deleted = 0
);

INSERT IGNORE INTO message_template (id, name, source_key, content, enabled, remark, is_deleted)
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
  FROM message_template
  WHERE source_key = 'network.tcp.natmap-endpoint-changed'
    AND name = 'TCP NATMap 端点变更默认模板'
    AND is_deleted = 0
);

UPDATE admin_menu
SET meta = '{"hideInMenu":true,"icon":"mdi:bell-outline","title":"system.notice.title"}'
WHERE name = 'SystemNotice'
  AND is_deleted = 0;

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
  (2041700000000100420,0,'MessageManagement','/message-management',NULL,'/message-management/subscription',NULL,'catalog','{"icon":"lucide:messages-square","order":109,"title":"消息管理"}',1,109),
  (2041700000000100414,2041700000000100420,'MessageManagementTemplate','/message-management/template','/message-management/template/list',NULL,'MessageManagement:Template:List','menu','{"icon":"lucide:message-square-plus","title":"消息模板"}',1,0),
  (2041700000000100413,2041700000000100420,'MessageManagementSubscription','/message-management/subscription','/message-management/subscription/list',NULL,'MessageManagement:Subscription:List','menu','{"icon":"lucide:bell-ring","title":"消息订阅"}',1,1),
  (2041700000000100423,2041700000000100420,'MessageManagementStationNoticeSubscriber','/message-management/subscribers/station-notice','/message-management/subscribers/station-notice/list',NULL,'MessageManagement:Push:List','menu','{"icon":"lucide:inbox","title":"站内信投递"}',1,2),
  (2041700000000120461,2041700000000100413,'MessageManagementSubscriptionList',NULL,NULL,NULL,'MessageManagement:Subscription:List','button','{"title":"common.list"}',1,0),
  (2041700000000120462,2041700000000100413,'MessageManagementSubscriptionCreate',NULL,NULL,NULL,'MessageManagement:Subscription:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120463,2041700000000100413,'MessageManagementSubscriptionUpdate',NULL,NULL,NULL,'MessageManagement:Subscription:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120464,2041700000000100413,'MessageManagementSubscriptionDelete',NULL,NULL,NULL,'MessageManagement:Subscription:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120465,2041700000000100413,'MessageManagementSubscriptionToggle',NULL,NULL,NULL,'MessageManagement:Subscription:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120471,2041700000000100414,'MessageManagementTemplateList',NULL,NULL,NULL,'MessageManagement:Template:List','button','{"title":"common.list"}',1,0),
  (2041700000000120472,2041700000000100414,'MessageManagementTemplateCreate',NULL,NULL,NULL,'MessageManagement:Template:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120473,2041700000000100414,'MessageManagementTemplateUpdate',NULL,NULL,NULL,'MessageManagement:Template:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120474,2041700000000100414,'MessageManagementTemplateDelete',NULL,NULL,NULL,'MessageManagement:Template:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120475,2041700000000100414,'MessageManagementTemplateToggle',NULL,NULL,NULL,'MessageManagement:Template:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120476,2041700000000100414,'MessageManagementTemplatePreview',NULL,NULL,NULL,'MessageManagement:Template:Preview','button','{"title":"预览"}',1,0),
  (2041700000000120491,2041700000000100423,'MessageManagementPushList',NULL,NULL,NULL,'MessageManagement:Push:List','button','{"title":"common.list"}',1,0),
  (2041700000000120492,2041700000000100423,'MessageManagementPushCreate',NULL,NULL,NULL,'MessageManagement:Push:Create','button','{"title":"common.create"}',1,0),
  (2041700000000120493,2041700000000100423,'MessageManagementPushUpdate',NULL,NULL,NULL,'MessageManagement:Push:Update','button','{"title":"common.edit"}',1,0),
  (2041700000000120494,2041700000000100423,'MessageManagementPushDelete',NULL,NULL,NULL,'MessageManagement:Push:Delete','button','{"title":"common.delete"}',1,0),
  (2041700000000120495,2041700000000100423,'MessageManagementPushToggle',NULL,NULL,NULL,'MessageManagement:Push:Toggle','button','{"title":"启停"}',1,0),
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
    2041700000000100420,
    2041700000000100413,
    2041700000000100414,
    2041700000000100423,
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
    2041700000000120491,
    2041700000000120492,
    2041700000000120493,
    2041700000000120494,
    2041700000000120495,
    2041700000000120481,
    2041700000000120482,
    2041700000000120483,
    2041700000000120484,
    2041700000000120485
  )
  AND menu.status = 1
  AND menu.is_deleted = 0;
