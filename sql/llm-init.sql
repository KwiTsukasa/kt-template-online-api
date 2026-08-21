-- 增量初始化大模型连接、对话、消息与 Admin 菜单；不写入任何真实凭据。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_llm_config` (
  `id` BIGINT NOT NULL PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `base_url` VARCHAR(1000) NOT NULL,
  `api_key_secret` TEXT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `connection_status` VARCHAR(16) NOT NULL DEFAULT 'untested',
  `first_token_latency_ms` INT NULL,
  `last_tested_at` DATETIME(6) NULL,
  `last_error_message` VARCHAR(500) NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY `idx_admin_llm_config_list` (`is_deleted`, `enabled`, `provider`),
  KEY `idx_admin_llm_config_status` (`is_deleted`, `connection_status`),
  KEY `idx_admin_llm_config_default` (`is_deleted`, `is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_llm_conversation` (
  `id` BIGINT NOT NULL PRIMARY KEY,
  `config_id` BIGINT NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `selected_model` VARCHAR(200) NULL,
  `selected_reasoning_effort` VARCHAR(64) NULL,
  `selected_service_tier` VARCHAR(64) NULL,
  `scene` VARCHAR(32) NOT NULL DEFAULT 'general',
  `scene_ref_id` VARCHAR(96) NULL,
  `provider_thread_id` VARCHAR(128) NULL,
  `active_turn_id` VARCHAR(96) NULL,
  `active_turn_started_at` DATETIME(6) NULL,
  `message_count` INT NOT NULL DEFAULT 0,
  `last_message_at` DATETIME(6) NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uk_admin_llm_conversation_scene_ref` (`scene`, `scene_ref_id`),
  KEY `idx_admin_llm_conversation_list` (`config_id`, `is_deleted`, `last_message_at`),
  CONSTRAINT `fk_admin_llm_conversation_config`
    FOREIGN KEY (`config_id`) REFERENCES `admin_llm_config` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_llm_message` (
  `id` BIGINT NOT NULL PRIMARY KEY,
  `conversation_id` BIGINT NOT NULL,
  `client_message_id` VARCHAR(96) NULL,
  `role` VARCHAR(16) NOT NULL,
  `model` VARCHAR(200) NULL,
  `content` LONGTEXT NOT NULL,
  `reasoning_content` LONGTEXT NULL,
  `status` VARCHAR(16) NOT NULL,
  `finish_reason` VARCHAR(64) NULL,
  `usage` JSON NULL,
  `metadata` JSON NULL,
  `sequence` INT NOT NULL,
  `error_message` VARCHAR(500) NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uk_admin_llm_message_sequence` (`conversation_id`, `sequence`),
  UNIQUE KEY `uk_admin_llm_message_client_id` (`conversation_id`, `client_message_id`),
  CONSTRAINT `fk_admin_llm_message_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `admin_llm_conversation` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @llm_conversation_reasoning_effort_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_conversation'
      AND column_name = 'selected_reasoning_effort'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_conversation` ADD COLUMN `selected_reasoning_effort` varchar(64) NULL AFTER `selected_model`'
);
PREPARE llm_conversation_reasoning_effort_stmt FROM @llm_conversation_reasoning_effort_sql;
EXECUTE llm_conversation_reasoning_effort_stmt;
DEALLOCATE PREPARE llm_conversation_reasoning_effort_stmt;

SET @llm_conversation_service_tier_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_conversation'
      AND column_name = 'selected_service_tier'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_conversation` ADD COLUMN `selected_service_tier` varchar(64) NULL AFTER `selected_reasoning_effort`'
);
PREPARE llm_conversation_service_tier_stmt FROM @llm_conversation_service_tier_sql;
EXECUTE llm_conversation_service_tier_stmt;
DEALLOCATE PREPARE llm_conversation_service_tier_stmt;

SET @llm_conversation_scene_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_conversation'
      AND column_name = 'scene'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_conversation` ADD COLUMN `scene` varchar(32) NOT NULL DEFAULT ''general'' AFTER `selected_model`'
);
PREPARE llm_conversation_scene_stmt FROM @llm_conversation_scene_sql;
EXECUTE llm_conversation_scene_stmt;
DEALLOCATE PREPARE llm_conversation_scene_stmt;

SET @llm_conversation_scene_ref_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_conversation'
      AND column_name = 'scene_ref_id'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_conversation` ADD COLUMN `scene_ref_id` varchar(96) NULL AFTER `scene`'
);
PREPARE llm_conversation_scene_ref_stmt FROM @llm_conversation_scene_ref_sql;
EXECUTE llm_conversation_scene_ref_stmt;
DEALLOCATE PREPARE llm_conversation_scene_ref_stmt;

SET @llm_conversation_scene_ref_index_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_conversation'
      AND index_name = 'uk_admin_llm_conversation_scene_ref'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_conversation` ADD UNIQUE KEY `uk_admin_llm_conversation_scene_ref` (`scene`, `scene_ref_id`)'
);
PREPARE llm_conversation_scene_ref_index_stmt FROM @llm_conversation_scene_ref_index_sql;
EXECUTE llm_conversation_scene_ref_index_stmt;
DEALLOCATE PREPARE llm_conversation_scene_ref_index_stmt;

SET @llm_message_metadata_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'admin_llm_message'
      AND column_name = 'metadata'
  ),
  'SELECT 1',
  'ALTER TABLE `admin_llm_message` ADD COLUMN `metadata` json NULL AFTER `usage`'
);
PREPARE llm_message_metadata_stmt FROM @llm_message_metadata_sql;
EXECUTE llm_message_metadata_stmt;
DEALLOCATE PREPARE llm_message_metadata_stmt;

INSERT INTO `admin_menu` (
  `id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`
) VALUES
  (2041700000000100500, 0, 'Llm', '/llm', NULL, '/llm/config', NULL, 'catalog', '{"icon":"lucide:brain-circuit","order":115,"title":"大模型"}', 1, 115),
  (2041700000000100501, 2041700000000100500, 'LlmConfig', '/llm/config', '/llm/config/index', NULL, 'Llm:Config:List', 'menu', '{"icon":"lucide:blocks","title":"大模型配置"}', 1, 0),
  (2041700000000100502, 2041700000000100500, 'LlmChat', '/llm/config/:configId/chat', '/llm/chat/index', NULL, 'Llm:Chat:Use', 'menu', '{"activePath":"/llm/config","hideInMenu":true,"title":"流式对话"}', 1, 1),
  (2041700000000120501, 2041700000000100501, 'LlmConfigCreate', NULL, NULL, NULL, 'Llm:Config:Create', 'button', '{"title":"common.create"}', 1, 1),
  (2041700000000120502, 2041700000000100501, 'LlmConfigUpdate', NULL, NULL, NULL, 'Llm:Config:Update', 'button', '{"title":"common.edit"}', 1, 2),
  (2041700000000120503, 2041700000000100501, 'LlmConfigDelete', NULL, NULL, NULL, 'Llm:Config:Delete', 'button', '{"title":"common.delete"}', 1, 3),
  (2041700000000120504, 2041700000000100501, 'LlmConfigTest', NULL, NULL, NULL, 'Llm:Config:Test', 'button', '{"title":"测试连接"}', 1, 4),
  (2041700000000120505, 2041700000000100501, 'LlmConfigDefault', NULL, NULL, NULL, 'Llm:Config:Default', 'button', '{"title":"设为默认"}', 1, 5),
  (2041700000000120506, 2041700000000100501, 'LlmConfigToggle', NULL, NULL, NULL, 'Llm:Config:Toggle', 'button', '{"title":"启停"}', 1, 6),
  (2041700000000120507, 2041700000000100502, 'LlmChatUse', NULL, NULL, NULL, 'Llm:Chat:Use', 'button', '{"title":"流式对话"}', 1, 1)
ON DUPLICATE KEY UPDATE
  `pid` = VALUES(`pid`),
  `name` = VALUES(`name`),
  `path` = VALUES(`path`),
  `component` = VALUES(`component`),
  `redirect` = VALUES(`redirect`),
  `auth_code` = VALUES(`auth_code`),
  `type` = VALUES(`type`),
  `meta` = VALUES(`meta`),
  `status` = VALUES(`status`),
  `sort` = VALUES(`sort`),
  `is_deleted` = 0;

DELETE role_menu
FROM `admin_role_menu` role_menu
JOIN `admin_role` role ON role.`id` = role_menu.`role_id`
JOIN `admin_menu` menu ON menu.`id` = role_menu.`menu_id`
WHERE role.`role_code` <> 'super'
  AND menu.`name` IN (
    'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
    'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
    'LlmChatUse'
  );

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN (
  'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
  'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
  'LlmChatUse'
)
WHERE role.`role_code` = 'super'
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`status` = 1
  AND menu.`is_deleted` = 0;
