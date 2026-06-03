-- QQBot 初始化 SQL
-- 用途：补齐 QQBot 表结构、后台菜单和默认角色授权。
-- 说明：本文件不清空任何已有角色菜单；请按目标环境手动导入。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `qqbot_account` (
  `id` bigint NOT NULL,
  `connection_mode` varchar(32) NOT NULL DEFAULT 'reverse-ws',
  `self_id` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL DEFAULT '',
  `access_token` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `connect_status` varchar(32) NOT NULL DEFAULT 'offline',
  `client_role` varchar(32) DEFAULT NULL,
  `last_connected_at` datetime DEFAULT NULL,
  `last_heartbeat_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qqbot_account_self_id` (`self_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_account_ability` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `ability_type` varchar(32) NOT NULL,
  `ability_key` varchar(128) NOT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qqbot_account_ability` (`account_id`, `ability_type`, `ability_key`),
  KEY `idx_qqbot_account_ability_self` (`self_id`, `ability_type`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_napcat_container` (
  `id` bigint NOT NULL,
  `name` varchar(120) NOT NULL,
  `base_url` varchar(255) NOT NULL,
  `webui_port` int DEFAULT NULL,
  `webui_token` varchar(255) DEFAULT NULL,
  `image` varchar(255) NOT NULL DEFAULT '',
  `data_dir` varchar(500) NOT NULL DEFAULT '',
  `reverse_ws_url` varchar(500) NOT NULL DEFAULT '',
  `status` varchar(32) NOT NULL DEFAULT 'creating',
  `last_started_at` datetime DEFAULT NULL,
  `last_checked_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qqbot_napcat_container_name` (`name`),
  KEY `idx_qqbot_napcat_container_status` (`status`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_account_napcat` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint NOT NULL,
  `bind_status` varchar(32) NOT NULL DEFAULT 'pending',
  `is_primary` tinyint(1) NOT NULL DEFAULT 1,
  `last_login_at` datetime DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_account_napcat_account` (`account_id`, `is_deleted`),
  KEY `idx_qqbot_account_napcat_container` (`container_id`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_config` (
  `id` bigint NOT NULL,
  `config_key` varchar(120) NOT NULL,
  `config_value` text NOT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qqbot_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_rule` (
  `id` bigint NOT NULL,
  `name` varchar(120) NOT NULL DEFAULT '',
  `match_type` varchar(32) NOT NULL DEFAULT 'keyword',
  `keyword` varchar(500) NOT NULL,
  `target_type` varchar(32) NOT NULL DEFAULT 'all',
  `reply_content` text NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `priority` int NOT NULL DEFAULT 0,
  `cooldown_ms` int NOT NULL DEFAULT 1500,
  `last_hit_at` datetime DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_rule_target` (`target_type`),
  KEY `idx_qqbot_rule_enabled` (`enabled`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_command` (
  `id` bigint NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(120) NOT NULL DEFAULT '',
  `aliases` text NOT NULL,
  `prefixes` varchar(120) NOT NULL DEFAULT '/,!,！',
  `plugin_key` varchar(80) NOT NULL,
  `operation_key` varchar(120) NOT NULL,
  `parser_key` varchar(40) NOT NULL DEFAULT 'plain',
  `target_type` varchar(32) NOT NULL DEFAULT 'all',
  `default_params` text DEFAULT NULL,
  `reply_template` text DEFAULT NULL,
  `error_template` text DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `priority` int NOT NULL DEFAULT 0,
  `cooldown_ms` int NOT NULL DEFAULT 1500,
  `last_hit_at` datetime DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_command_code` (`code`, `is_deleted`),
  KEY `idx_qqbot_command_plugin` (`plugin_key`, `operation_key`),
  KEY `idx_qqbot_command_enabled` (`enabled`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_command_log` (
  `id` bigint NOT NULL,
  `command_id` varchar(64) NOT NULL,
  `command_code` varchar(80) NOT NULL DEFAULT '',
  `plugin_key` varchar(80) NOT NULL,
  `operation_key` varchar(120) NOT NULL,
  `self_id` varchar(64) NOT NULL DEFAULT '',
  `target_type` varchar(32) NOT NULL DEFAULT 'private',
  `target_id` varchar(64) NOT NULL DEFAULT '',
  `user_id` varchar(64) NOT NULL DEFAULT '',
  `raw_message` text NOT NULL,
  `input` longtext DEFAULT NULL,
  `output` longtext DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'success',
  `error_message` text DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_command_log_command` (`command_id`, `status`),
  KEY `idx_qqbot_command_log_target` (`self_id`, `target_type`, `target_id`),
  KEY `idx_qqbot_command_log_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_conversation` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `target_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `target_name` varchar(120) NOT NULL DEFAULT '',
  `last_message_id` varchar(64) DEFAULT NULL,
  `last_message_text` text NOT NULL,
  `last_message_time` datetime DEFAULT NULL,
  `message_count` int NOT NULL DEFAULT 0,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_conversation_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_message` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `message_id` varchar(64) DEFAULT NULL,
  `conversation_id` varchar(64) DEFAULT NULL,
  `direction` varchar(32) NOT NULL DEFAULT 'inbound',
  `message_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `group_id` varchar(64) DEFAULT NULL,
  `user_id` varchar(64) NOT NULL,
  `sender_nickname` varchar(120) NOT NULL DEFAULT '',
  `raw_message` text NOT NULL,
  `message_text` text NOT NULL,
  `raw_event` longtext DEFAULT NULL,
  `event_time` datetime NOT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_message_self_message` (`self_id`, `message_id`),
  KEY `idx_qqbot_message_target` (`self_id`, `message_type`, `target_id`),
  KEY `idx_qqbot_message_event_time` (`event_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_send_log` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `target_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `action` varchar(64) NOT NULL,
  `message_text` text NOT NULL,
  `params` longtext DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `echo` varchar(80) DEFAULT NULL,
  `message_id` varchar(64) DEFAULT NULL,
  `error_message` varchar(500) DEFAULT NULL,
  `response` longtext DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_send_log_target` (`self_id`, `target_type`, `target_id`),
  KEY `idx_qqbot_send_log_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_allowlist` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL DEFAULT '',
  `target_type` varchar(32) NOT NULL DEFAULT 'qq',
  `target_id` varchar(64) NOT NULL DEFAULT '',
  `user_id` varchar(64) NOT NULL DEFAULT '',
  `precise_user` tinyint(1) NOT NULL DEFAULT 0,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_allowlist_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_blocklist` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL DEFAULT '',
  `target_type` varchar(32) NOT NULL DEFAULT 'qq',
  `target_id` varchar(64) NOT NULL DEFAULT '',
  `user_id` varchar(64) NOT NULL DEFAULT '',
  `precise_user` tinyint(1) NOT NULL DEFAULT 0,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_qqbot_blocklist_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `qqbot_dedupe` (
  `id` bigint NOT NULL,
  `event_key` varchar(255) NOT NULL,
  `expire_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qqbot_dedupe_event_key` (`event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `qqbot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
     SELECT CAST((UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 1288834974657) * 4194304 + 100000 + ROW_NUMBER() OVER (ORDER BY `legacy`.`account_id`, `legacy`.`ability_key`) AS UNSIGNED) AS `id`,
            `legacy`.`account_id`,
            `legacy`.`self_id`,
            ''command'' AS `ability_type`,
            `legacy`.`ability_key`,
            0 AS `is_deleted`
     FROM (
       SELECT `account`.`id` AS `account_id`,
              `account`.`self_id`,
              TRIM(CASE JSON_TYPE(`binding`.`raw_item`)
                WHEN ''STRING'' THEN JSON_UNQUOTE(`binding`.`raw_item`)
                WHEN ''OBJECT'' THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.id'')), JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.key'')), '''')
                ELSE ''''
              END) AS `ability_key`,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.enabled'')), ''true'') AS `binding_enabled`
       FROM `qqbot_account` `account`
       JOIN JSON_TABLE(IF(JSON_VALID(`account`.`command_bindings`), `account`.`command_bindings`, ''[]''), ''$[*]'' COLUMNS (`raw_item` json PATH ''$'')) AS `binding`
       WHERE `account`.`is_deleted` = 0
     ) `legacy`
     WHERE `legacy`.`ability_key` <> ''''
       AND `legacy`.`binding_enabled` <> ''false''
     ON DUPLICATE KEY UPDATE `self_id` = VALUES(`self_id`), `is_deleted` = 0',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'command_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `qqbot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
     SELECT CAST((UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 1288834974657) * 4194304 + 200000 + ROW_NUMBER() OVER (ORDER BY `legacy`.`account_id`, `legacy`.`ability_key`) AS UNSIGNED) AS `id`,
            `legacy`.`account_id`,
            `legacy`.`self_id`,
            ''rule'' AS `ability_type`,
            `legacy`.`ability_key`,
            0 AS `is_deleted`
     FROM (
       SELECT `account`.`id` AS `account_id`,
              `account`.`self_id`,
              TRIM(CASE JSON_TYPE(`binding`.`raw_item`)
                WHEN ''STRING'' THEN JSON_UNQUOTE(`binding`.`raw_item`)
                WHEN ''OBJECT'' THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.id'')), JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.key'')), '''')
                ELSE ''''
              END) AS `ability_key`,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.enabled'')), ''true'') AS `binding_enabled`
       FROM `qqbot_account` `account`
       JOIN JSON_TABLE(IF(JSON_VALID(`account`.`rule_bindings`), `account`.`rule_bindings`, ''[]''), ''$[*]'' COLUMNS (`raw_item` json PATH ''$'')) AS `binding`
       WHERE `account`.`is_deleted` = 0
     ) `legacy`
     WHERE `legacy`.`ability_key` <> ''''
       AND `legacy`.`binding_enabled` <> ''false''
     ON DUPLICATE KEY UPDATE `self_id` = VALUES(`self_id`), `is_deleted` = 0',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'rule_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `qqbot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
     SELECT CAST((UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 1288834974657) * 4194304 + 300000 + ROW_NUMBER() OVER (ORDER BY `legacy`.`account_id`, `legacy`.`ability_key`) AS UNSIGNED) AS `id`,
            `legacy`.`account_id`,
            `legacy`.`self_id`,
            ''event_plugin'' AS `ability_type`,
            `legacy`.`ability_key`,
            0 AS `is_deleted`
     FROM (
       SELECT `account`.`id` AS `account_id`,
              `account`.`self_id`,
              TRIM(CASE JSON_TYPE(`binding`.`raw_item`)
                WHEN ''STRING'' THEN JSON_UNQUOTE(`binding`.`raw_item`)
                WHEN ''OBJECT'' THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.id'')), JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.key'')), '''')
                ELSE ''''
              END) AS `ability_key`,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`binding`.`raw_item`, ''$.enabled'')), ''true'') AS `binding_enabled`
       FROM `qqbot_account` `account`
       JOIN JSON_TABLE(IF(JSON_VALID(`account`.`event_plugin_bindings`), `account`.`event_plugin_bindings`, ''[]''), ''$[*]'' COLUMNS (`raw_item` json PATH ''$'')) AS `binding`
       WHERE `account`.`is_deleted` = 0
     ) `legacy`
     WHERE `legacy`.`ability_key` <> ''''
       AND `legacy`.`binding_enabled` <> ''false''
     ON DUPLICATE KEY UPDATE `self_id` = VALUES(`self_id`), `is_deleted` = 0',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'event_plugin_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `qqbot_rule` DROP COLUMN `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_rule'
    AND column_name = 'self_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `qqbot_command` DROP COLUMN `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_command'
    AND column_name = 'self_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `qqbot_account` DROP COLUMN `command_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'command_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `qqbot_account` DROP COLUMN `rule_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'rule_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `qqbot_account` DROP COLUMN `event_plugin_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'event_plugin_bindings'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_allowlist` ADD COLUMN `user_id` varchar(64) NOT NULL DEFAULT '''' AFTER `target_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_allowlist'
    AND column_name = 'user_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_allowlist` ADD COLUMN `precise_user` tinyint(1) NOT NULL DEFAULT 0 AFTER `user_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_allowlist'
    AND column_name = 'precise_user'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_blocklist` ADD COLUMN `user_id` varchar(64) NOT NULL DEFAULT '''' AFTER `target_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_blocklist'
    AND column_name = 'user_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_blocklist` ADD COLUMN `precise_user` tinyint(1) NOT NULL DEFAULT 0 AFTER `user_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_blocklist'
    AND column_name = 'precise_user'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

INSERT INTO `qqbot_config` (`id`, `config_key`, `config_value`, `remark`)
VALUES
  (2041700000000200501, 'permission.allowlistEnabled', 'false', 'QQBot 白名单总开关'),
  (2041700000000200502, 'permission.blocklistEnabled', 'true', 'QQBot 黑名单总开关')
ON DUPLICATE KEY UPDATE
  `config_key` = VALUES(`config_key`);

INSERT INTO `qqbot_command` (`id`, `code`, `name`, `aliases`, `prefixes`, `plugin_key`, `operation_key`, `parser_key`, `target_type`, `default_params`, `reply_template`, `error_template`, `enabled`, `priority`, `cooldown_ms`, `remark`)
VALUES
  (2041700000000300501, 'ff14_price', 'FF14 查价', '["查价","price","ff14price"]', '["/","!","！"]', 'ff14Market', 'ff14.market.price', 'ff14Price', 'all', '{"language":"chs","world":"中国"}', '', 'FF14 查价失败：{{error}}', 1, 0, 1500, '默认示例命令；请在账号配置中绑定后启用'),
  (2041700000000300502, 'fflogs_character', 'FFLogs 查询', '["fflogs","logs","查logs","查log"]', '["/","!","！"]', 'fflogs', 'fflogs.character.summary', 'fflogsCharacter', 'all', '{"serverRegion":"CN"}', '', 'FFLogs 查询失败：{{error}}', 1, 0, 3000, '查询 FFLogs 角色公开排名；带高难任务时返回最近10次记录；格式：/fflogs 角色名 服务器 [高难任务]')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `plugin_key` = VALUES(`plugin_key`),
  `operation_key` = VALUES(`operation_key`),
  `parser_key` = VALUES(`parser_key`),
  `target_type` = VALUES(`target_type`),
  `enabled` = VALUES(`enabled`),
  `remark` = VALUES(`remark`),
  `is_deleted` = 0;

UPDATE `admin_menu`
SET `name` = 'QqBotAccountConfigButton'
WHERE `id` = 2041700000000120406
  AND `name` = 'QqBotAccountConfig';

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000300401, 'QQBOT_PLUGIN_TRIGGER_MODE', '命令', 'command', NULL, 1, 1),
  (2041700000000300402, 'QQBOT_PLUGIN_TRIGGER_MODE', '事件', 'event', NULL, 2, 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000300601, 'FFLOGS_ENCOUNTER_LABEL', 'M9S Vamp Fatale', 'vampfatale', NULL, 1, 1),
  (2041700000000300602, 'FFLOGS_ENCOUNTER_LABEL', 'M10S Red Hot and Deep Blue', 'redhotanddeepblue', NULL, 2, 1),
  (2041700000000300603, 'FFLOGS_ENCOUNTER_LABEL', 'M11S The Tyrant', 'thetyrant', NULL, 3, 1),
  (2041700000000300604, 'FFLOGS_ENCOUNTER_LABEL', 'M12S P1 Lindwurm', 'lindwurm', NULL, 4, 1),
  (2041700000000300605, 'FFLOGS_ENCOUNTER_LABEL', 'M12S P2 Lindwurm II', 'lindwurmii', NULL, 5, 1),
  (2041700000000300701, 'FFLOGS_JOB_LABEL', '骑士', 'paladin', NULL, 1, 1),
  (2041700000000300702, 'FFLOGS_JOB_LABEL', '战士', 'warrior', NULL, 2, 1),
  (2041700000000300703, 'FFLOGS_JOB_LABEL', '暗黑骑士', 'darkknight', NULL, 3, 1),
  (2041700000000300704, 'FFLOGS_JOB_LABEL', '绝枪战士', 'gunbreaker', NULL, 4, 1),
  (2041700000000300705, 'FFLOGS_JOB_LABEL', '白魔法师', 'whitemage', NULL, 5, 1),
  (2041700000000300706, 'FFLOGS_JOB_LABEL', '学者', 'scholar', NULL, 6, 1),
  (2041700000000300707, 'FFLOGS_JOB_LABEL', '占星术士', 'astrologian', NULL, 7, 1),
  (2041700000000300708, 'FFLOGS_JOB_LABEL', '贤者', 'sage', NULL, 8, 1),
  (2041700000000300709, 'FFLOGS_JOB_LABEL', '武僧', 'monk', NULL, 9, 1),
  (2041700000000300710, 'FFLOGS_JOB_LABEL', '龙骑士', 'dragoon', NULL, 10, 1),
  (2041700000000300711, 'FFLOGS_JOB_LABEL', '忍者', 'ninja', NULL, 11, 1),
  (2041700000000300712, 'FFLOGS_JOB_LABEL', '武士', 'samurai', NULL, 12, 1),
  (2041700000000300713, 'FFLOGS_JOB_LABEL', '钐镰客', 'reaper', NULL, 13, 1),
  (2041700000000300714, 'FFLOGS_JOB_LABEL', '蝰蛇剑士', 'viper', NULL, 14, 1),
  (2041700000000300715, 'FFLOGS_JOB_LABEL', '吟游诗人', 'bard', NULL, 15, 1),
  (2041700000000300716, 'FFLOGS_JOB_LABEL', '机工士', 'machinist', NULL, 16, 1),
  (2041700000000300717, 'FFLOGS_JOB_LABEL', '舞者', 'dancer', NULL, 17, 1),
  (2041700000000300718, 'FFLOGS_JOB_LABEL', '黑魔法师', 'blackmage', NULL, 18, 1),
  (2041700000000300719, 'FFLOGS_JOB_LABEL', '召唤师', 'summoner', NULL, 19, 1),
  (2041700000000300720, 'FFLOGS_JOB_LABEL', '赤魔法师', 'redmage', NULL, 20, 1),
  (2041700000000300721, 'FFLOGS_JOB_LABEL', '绘灵法师', 'pictomancer', NULL, 21, 1),
  (2041700000000300722, 'FFLOGS_JOB_LABEL', '青魔法师', 'bluemage', NULL, 22, 1),
  (2041700000000300801, 'FFLOGS_METRIC_LABEL', 'DPS', 'dps', NULL, 1, 1),
  (2041700000000300802, 'FFLOGS_METRIC_LABEL', 'HPS', 'hps', NULL, 2, 1),
  (2041700000000300803, 'FFLOGS_METRIC_LABEL', 'rDPS', 'rdps', NULL, 3, 1),
  (2041700000000300804, 'FFLOGS_METRIC_LABEL', 'aDPS', 'adps', NULL, 4, 1),
  (2041700000000300805, 'FFLOGS_METRIC_LABEL', 'nDPS', 'ndps', NULL, 5, 1),
  (2041700000000300806, 'FFLOGS_METRIC_LABEL', 'Boss DPS', 'bossdps', NULL, 6, 1),
  (2041700000000300807, 'FFLOGS_METRIC_LABEL', 'Boss rDPS', 'bossrdps', NULL, 7, 1),
  (2041700000000300808, 'FFLOGS_METRIC_LABEL', 'aDPS', 'cdps', NULL, 8, 1),
  (2041700000000300901, 'FFLOGS_ROLE_LABEL', '坦克', 'tank', NULL, 1, 1),
  (2041700000000300902, 'FFLOGS_ROLE_LABEL', '治疗', 'healer', NULL, 2, 1),
  (2041700000000300903, 'FFLOGS_ROLE_LABEL', '输出', 'dps', NULL, 3, 1),
  (2041700000000301001, 'FFLOGS_SERVER_REGION_LABEL', '国服', 'cn', NULL, 1, 1),
  (2041700000000301002, 'FFLOGS_SERVER_REGION_LABEL', '日服', 'jp', NULL, 2, 1),
  (2041700000000301003, 'FFLOGS_SERVER_REGION_LABEL', '美服', 'na', NULL, 3, 1),
  (2041700000000301004, 'FFLOGS_SERVER_REGION_LABEL', '欧服', 'eu', NULL, 4, 1),
  (2041700000000301005, 'FFLOGS_SERVER_REGION_LABEL', '韩服', 'kr', NULL, 5, 1),
  (2041700000000301006, 'FFLOGS_SERVER_REGION_LABEL', '台服', 'tw', NULL, 6, 1),
  (2041700000000301007, 'FFLOGS_SERVER_REGION_LABEL', '澳服', 'oc', NULL, 7, 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000301101, 'FF14_MARKET_REGION', '中国', '中国', 'FF14_MARKET_DATA_CENTER_CN', 1, 1),
  (2041700000000301201, 'FF14_MARKET_DATA_CENTER_CN', '陆行鸟', '陆行鸟', 'FF14_MARKET_WORLD_CN_LUXINGNIAO', 1, 1),
  (2041700000000301202, 'FF14_MARKET_DATA_CENTER_CN', '莫古力', '莫古力', 'FF14_MARKET_WORLD_CN_MOGULI', 2, 1),
  (2041700000000301203, 'FF14_MARKET_DATA_CENTER_CN', '猫小胖', '猫小胖', 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', 3, 1),
  (2041700000000301204, 'FF14_MARKET_DATA_CENTER_CN', '豆豆柴', '豆豆柴', 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', 4, 1),
  (2041700000000301301, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '红玉海', '红玉海', NULL, 1, 1),
  (2041700000000301302, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '神意之地', '神意之地', NULL, 2, 1),
  (2041700000000301303, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '拉诺西亚', '拉诺西亚', NULL, 3, 1),
  (2041700000000301304, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '幻影群岛', '幻影群岛', NULL, 4, 1),
  (2041700000000301305, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '萌芽池', '萌芽池', NULL, 5, 1),
  (2041700000000301306, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '宇宙和音', '宇宙和音', NULL, 6, 1),
  (2041700000000301307, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '沃仙曦染', '沃仙曦染', NULL, 7, 1),
  (2041700000000301308, 'FF14_MARKET_WORLD_CN_LUXINGNIAO', '晨曦王座', '晨曦王座', NULL, 8, 1),
  (2041700000000301309, 'FF14_MARKET_WORLD_CN_MOGULI', '白银乡', '白银乡', NULL, 1, 1),
  (2041700000000301310, 'FF14_MARKET_WORLD_CN_MOGULI', '白金幻象', '白金幻象', NULL, 2, 1),
  (2041700000000301311, 'FF14_MARKET_WORLD_CN_MOGULI', '神拳痕', '神拳痕', NULL, 3, 1),
  (2041700000000301312, 'FF14_MARKET_WORLD_CN_MOGULI', '潮风亭', '潮风亭', NULL, 4, 1),
  (2041700000000301313, 'FF14_MARKET_WORLD_CN_MOGULI', '旅人栈桥', '旅人栈桥', NULL, 5, 1),
  (2041700000000301314, 'FF14_MARKET_WORLD_CN_MOGULI', '拂晓之间', '拂晓之间', NULL, 6, 1),
  (2041700000000301315, 'FF14_MARKET_WORLD_CN_MOGULI', '龙巢神殿', '龙巢神殿', NULL, 7, 1),
  (2041700000000301316, 'FF14_MARKET_WORLD_CN_MOGULI', '梦羽宝境', '梦羽宝境', NULL, 8, 1),
  (2041700000000301317, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '紫水栈桥', '紫水栈桥', NULL, 1, 1),
  (2041700000000301318, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '延夏', '延夏', NULL, 2, 1),
  (2041700000000301319, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '静语庄园', '静语庄园', NULL, 3, 1),
  (2041700000000301320, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '摩杜纳', '摩杜纳', NULL, 4, 1),
  (2041700000000301321, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '海猫茶屋', '海猫茶屋', NULL, 5, 1),
  (2041700000000301322, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '柔风海湾', '柔风海湾', NULL, 6, 1),
  (2041700000000301323, 'FF14_MARKET_WORLD_CN_MAOXIAOPANG', '琥珀原', '琥珀原', NULL, 7, 1),
  (2041700000000301324, 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', '水晶塔', '水晶塔', NULL, 1, 1),
  (2041700000000301325, 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', '银泪湖', '银泪湖', NULL, 2, 1),
  (2041700000000301326, 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', '太阳海岸', '太阳海岸', NULL, 3, 1),
  (2041700000000301327, 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', '伊修加德', '伊修加德', NULL, 4, 1),
  (2041700000000301328, 'FF14_MARKET_WORLD_CN_DOUDOUCHAI', '红茶川', '红茶川', NULL, 5, 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_menu` (`id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`)
VALUES
  (2041700000000100400, 0, 'QqBot', '/qqbot', NULL, '/qqbot/dashboard', NULL, 'catalog', '{"icon":"lucide:bot","order":110,"title":"QQBot 管理"}', 1, 110),
  (2041700000000100401, 2041700000000100400, 'QqBotDashboard', '/qqbot/dashboard', '/qqbot/dashboard/list', NULL, 'QqBot:Dashboard:List', 'menu', '{"icon":"lucide:gauge","title":"工作台"}', 1, 0),
  (2041700000000100402, 2041700000000100400, 'QqBotAccount', '/qqbot/account', '/qqbot/account/list', NULL, 'QqBot:Account:List', 'menu', '{"icon":"lucide:radio-receiver","title":"账号连接"}', 1, 1),
  (2041700000000100410, 2041700000000100400, 'QqBotAccountConfig', '/qqbot/account/config', '/qqbot/account/config', NULL, 'QqBot:Account:Config', 'menu', '{"activePath":"/qqbot/account","hideInMenu":true,"title":"账号功能配置"}', 1, 0),
  (2041700000000120401, 2041700000000100402, 'QqBotAccountCreate', NULL, NULL, NULL, 'QqBot:Account:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120402, 2041700000000100402, 'QqBotAccountEdit', NULL, NULL, NULL, 'QqBot:Account:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120403, 2041700000000100402, 'QqBotAccountDelete', NULL, NULL, NULL, 'QqBot:Account:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120404, 2041700000000100402, 'QqBotAccountKick', NULL, NULL, NULL, 'QqBot:Account:Kick', 'button', '{"title":"断开连接"}', 1, 0),
  (2041700000000120405, 2041700000000100402, 'QqBotAccountRefreshLogin', NULL, NULL, NULL, 'QqBot:Account:RefreshLogin', 'button', '{"title":"更新登录"}', 1, 0),
  (2041700000000120406, 2041700000000100402, 'QqBotAccountConfigButton', NULL, NULL, NULL, 'QqBot:Account:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000100403, 2041700000000100400, 'QqBotRule', '/qqbot/rule', '/qqbot/rule/list', NULL, 'QqBot:Rule:List', 'menu', '{"icon":"lucide:workflow","title":"自动回复规则"}', 1, 2),
  (2041700000000120411, 2041700000000100403, 'QqBotRuleCreate', NULL, NULL, NULL, 'QqBot:Rule:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120412, 2041700000000100403, 'QqBotRuleEdit', NULL, NULL, NULL, 'QqBot:Rule:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120413, 2041700000000100403, 'QqBotRuleDelete', NULL, NULL, NULL, 'QqBot:Rule:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120414, 2041700000000100403, 'QqBotRuleToggle', NULL, NULL, NULL, 'QqBot:Rule:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000100408, 2041700000000100400, 'QqBotCommand', '/qqbot/command', '/qqbot/command/list', NULL, 'QqBot:Command:List', 'menu', '{"icon":"lucide:square-terminal","title":"在线命令"}', 1, 3),
  (2041700000000120441, 2041700000000100408, 'QqBotCommandCreate', NULL, NULL, NULL, 'QqBot:Command:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120442, 2041700000000100408, 'QqBotCommandEdit', NULL, NULL, NULL, 'QqBot:Command:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120443, 2041700000000100408, 'QqBotCommandDelete', NULL, NULL, NULL, 'QqBot:Command:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120444, 2041700000000100408, 'QqBotCommandToggle', NULL, NULL, NULL, 'QqBot:Command:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000120445, 2041700000000100408, 'QqBotCommandTest', NULL, NULL, NULL, 'QqBot:Command:Test', 'button', '{"title":"测试命令"}', 1, 0),
  (2041700000000100409, 2041700000000100400, 'QqBotPlugin', '/qqbot/plugin', '/qqbot/plugin/list', NULL, 'QqBot:Plugin:List', 'menu', '{"icon":"lucide:plug","title":"插件能力"}', 1, 4),
  (2041700000000100404, 2041700000000100400, 'QqBotConversation', '/qqbot/conversation', '/qqbot/conversation/list', NULL, 'QqBot:Conversation:List', 'menu', '{"icon":"lucide:messages-square","title":"会话管理"}', 1, 5),
  (2041700000000100405, 2041700000000100400, 'QqBotMessage', '/qqbot/message', '/qqbot/message/list', NULL, 'QqBot:Message:List', 'menu', '{"icon":"lucide:message-square-text","title":"消息日志"}', 1, 6),
  (2041700000000100406, 2041700000000100400, 'QqBotSendLog', '/qqbot/sendLog', '/qqbot/sendLog/list', NULL, 'QqBot:SendLog:List', 'menu', '{"icon":"lucide:send","title":"发送日志"}', 1, 7),
  (2041700000000120421, 2041700000000100406, 'QqBotSendPrivate', NULL, NULL, NULL, 'QqBot:Send:Private', 'button', '{"title":"发送私聊"}', 1, 0),
  (2041700000000120422, 2041700000000100406, 'QqBotSendGroup', NULL, NULL, NULL, 'QqBot:Send:Group', 'button', '{"title":"发送群聊"}', 1, 0),
  (2041700000000100407, 2041700000000100400, 'QqBotPermission', '/qqbot/permission', '/qqbot/permission/list', NULL, 'QqBot:Permission:List', 'menu', '{"icon":"lucide:shield-check","title":"权限名单"}', 1, 8),
  (2041700000000120431, 2041700000000100407, 'QqBotPermissionCreate', NULL, NULL, NULL, 'QqBot:Permission:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120432, 2041700000000100407, 'QqBotPermissionEdit', NULL, NULL, NULL, 'QqBot:Permission:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120433, 2041700000000100407, 'QqBotPermissionDelete', NULL, NULL, NULL, 'QqBot:Permission:Delete', 'button', '{"title":"common.delete"}', 1, 0)
ON DUPLICATE KEY UPDATE
  `pid` = VALUES(`pid`),
  `path` = VALUES(`path`),
  `component` = VALUES(`component`),
  `redirect` = VALUES(`redirect`),
  `auth_code` = VALUES(`auth_code`),
  `type` = VALUES(`type`),
  `meta` = VALUES(`meta`),
  `status` = VALUES(`status`),
  `sort` = VALUES(`sort`),
  `is_deleted` = 0;

UPDATE `admin_menu`
SET `status` = 0,
    `is_deleted` = 1
WHERE `name` IN ('QqBotEventPlugin', 'QqBotEventPluginToggle');

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` LIKE 'QqBot%'
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;

SET FOREIGN_KEY_CHECKS = 1;
