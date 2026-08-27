-- Bot / Bot Adapter / Plugin Platform 初始化 SQL
-- 用途：补齐 Bot 表结构、新后台菜单和默认角色授权。
-- 说明：本文件不清空任何已有角色菜单；请按目标环境手动导入。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `bot_account` (
  `id` bigint NOT NULL,
  `connection_mode` varchar(32) NOT NULL DEFAULT 'reverse-ws',
  `self_id` varchar(64) NOT NULL,
  `official_app_id` varchar(64) DEFAULT NULL,
  `name` varchar(120) NOT NULL DEFAULT '',
  `access_token` varchar(255) DEFAULT NULL,
  `napcat_login_password_secret` varchar(1024) DEFAULT NULL,
  `official_app_secret_ciphertext` varchar(1024) DEFAULT NULL,
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
  UNIQUE KEY `uk_bot_account_self_id` (`self_id`),
  UNIQUE KEY `uk_bot_account_official_app_id` (`official_app_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_account_ability` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `ability_type` varchar(32) NOT NULL,
  `ability_key` varchar(128) NOT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_account_ability` (`account_id`, `ability_type`, `ability_key`),
  KEY `idx_bot_account_ability_self` (`self_id`, `ability_type`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_container` (
  `id` bigint NOT NULL,
  `account_id` bigint DEFAULT NULL,
  `container_name` varchar(120) NOT NULL,
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
  UNIQUE KEY `uk_napcat_container_name` (`container_name`),
  KEY `idx_napcat_container_status` (`status`, `is_deleted`),
  KEY `idx_napcat_container_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_device_identity` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint DEFAULT NULL,
  `data_dir` varchar(512) NOT NULL,
  `hostname` varchar(128) NOT NULL,
  `hostname_strategy` varchar(64) NOT NULL DEFAULT 'legacy',
  `machine_id_path` varchar(512) NOT NULL,
  `mac_address` varchar(64) NOT NULL,
  `mac_strategy` varchar(64) NOT NULL DEFAULT 'legacy',
  `verification_status` varchar(32) NOT NULL,
  `last_login_evidence` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_napcat_device_identity_account` (`account_id`),
  KEY `idx_napcat_device_identity_container` (`container_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_account_binding` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint NOT NULL,
  `device_identity_id` bigint DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `is_primary` tinyint(1) NOT NULL DEFAULT 1,
  `last_login_at` datetime DEFAULT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_napcat_account_binding_account` (`account_id`),
  KEY `idx_napcat_account_binding_container` (`container_id`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_login_session` (
  `id` bigint NOT NULL,
  `account_id` bigint DEFAULT NULL,
  `session_key` varchar(128) NOT NULL,
  `login_stage` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL,
  `progress_message` varchar(255) NOT NULL,
  `session_payload` json DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_napcat_login_session_key` (`session_key`),
  KEY `idx_napcat_login_session_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_login_challenge` (
  `id` bigint NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `challenge_type` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL,
  `challenge_url` text,
  `challenge_payload` json DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_login_challenge_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_runtime_cleanup` (
  `id` bigint NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `cleanup_type` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL,
  `error_message` text,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_runtime_cleanup_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_runtime_profile` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint DEFAULT NULL,
  `device_identity_id` bigint DEFAULT NULL,
  `profile_version` varchar(64) NOT NULL,
  `image_ref` varchar(255) NOT NULL,
  `image_digest` varchar(255) DEFAULT NULL,
  `base_image_digest` varchar(255) DEFAULT NULL,
  `desktop_profile_version` varchar(64) DEFAULT NULL,
  `locale_available` tinyint(1) NOT NULL DEFAULT 0,
  `fontconfig_evidence` json DEFAULT NULL,
  `timezone_evidence` json DEFAULT NULL,
  `runtime_uid` int DEFAULT NULL,
  `runtime_gid` int DEFAULT NULL,
  `shm_size` varchar(32) DEFAULT NULL,
  `locale` varchar(64) DEFAULT NULL,
  `xdg_config_home` varchar(255) DEFAULT NULL,
  `xdg_cache_home` varchar(255) DEFAULT NULL,
  `xdg_data_home` varchar(255) DEFAULT NULL,
  `persist_cache` tinyint(1) NOT NULL DEFAULT 1,
  `persist_local_share` tinyint(1) NOT NULL DEFAULT 1,
  `persist_logs` tinyint(1) NOT NULL DEFAULT 1,
  `hostname_strategy` varchar(64) NOT NULL,
  `mac_strategy` varchar(64) NOT NULL,
  `migrate_device_identity` tinyint(1) NOT NULL DEFAULT 0,
  `profile_status` varchar(32) NOT NULL,
  `last_check_evidence` json DEFAULT NULL,
  `last_checked_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_runtime_profile_account` (`account_id`),
  UNIQUE KEY `uk_napcat_runtime_profile_container` (`container_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_protocol_profile` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint DEFAULT NULL,
  `profile_version` varchar(64) NOT NULL,
  `packet_backend` varchar(64) NOT NULL,
  `packet_server` varchar(255) NOT NULL DEFAULT '',
  `o3_hook_mode` int NOT NULL DEFAULT 1,
  `o3_hook_gray_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `onebot_config_hash` varchar(128) DEFAULT NULL,
  `onebot_config_json` json DEFAULT NULL,
  `napcat_config_hash` varchar(128) DEFAULT NULL,
  `napcat_config_json` json DEFAULT NULL,
  `profile_status` varchar(32) NOT NULL,
  `last_check_evidence` json DEFAULT NULL,
  `last_checked_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_protocol_profile_account` (`account_id`),
  UNIQUE KEY `uk_napcat_protocol_profile_container` (`container_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_session_behavior_profile` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `profile_version` varchar(64) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `cold_start_until` datetime DEFAULT NULL,
  `housekeeping_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `housekeeping_interval_ms` int DEFAULT NULL,
  `next_housekeeping_at` datetime DEFAULT NULL,
  `last_housekeeping_at` datetime DEFAULT NULL,
  `last_housekeeping_result` json DEFAULT NULL,
  `presence_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `presence_strategy` varchar(64) DEFAULT NULL,
  `last_presence_event_at` datetime DEFAULT NULL,
  `next_presence_event_at` datetime DEFAULT NULL,
  `auto_capability_stage` varchar(32) NOT NULL,
  `last_behavior_evidence` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_session_behavior_profile_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_login_event` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `container_id` bigint DEFAULT NULL,
  `event_kind` varchar(64) NOT NULL,
  `event_source` varchar(32) NOT NULL,
  `event_status` varchar(32) NOT NULL,
  `evidence` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_login_event_account` (`account_id`, `create_time`),
  KEY `idx_napcat_login_event_container` (`container_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_risk_mode` (
  `id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `risk_mode` varchar(32) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `source_event` varchar(64) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `last_evidence` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_napcat_risk_mode_account` (`account_id`),
  KEY `idx_napcat_risk_mode_mode` (`risk_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `napcat_webui_gateway_audit` (
  `id` bigint NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `admin_user_id` bigint NOT NULL,
  `account_id` bigint NOT NULL,
  `self_id` varchar(32) NOT NULL,
  `container_id` bigint NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `client_ip` varchar(128) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `detail_json` json DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_napcat_webui_gateway_audit_session` (`session_id`),
  KEY `idx_napcat_webui_gateway_audit_account_event` (`account_id`, `event_type`),
  KEY `idx_napcat_webui_gateway_audit_admin_time` (`admin_user_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_config` (
  `id` bigint NOT NULL,
  `config_key` varchar(120) NOT NULL,
  `config_value` text NOT NULL,
  `remark` varchar(255) NOT NULL DEFAULT '',
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_rule` (
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
  KEY `idx_bot_rule_target` (`target_type`),
  KEY `idx_bot_rule_enabled` (`enabled`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_command` (
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
  KEY `idx_bot_command_code` (`code`, `is_deleted`),
  KEY `idx_bot_command_plugin` (`plugin_key`, `operation_key`),
  KEY `idx_bot_command_enabled` (`enabled`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_command_log` (
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
  KEY `idx_bot_command_log_command` (`command_id`, `status`),
  KEY `idx_bot_command_log_target` (`self_id`, `target_type`, `target_id`),
  KEY `idx_bot_command_log_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_conversation` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `target_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `target_name` varchar(120) NOT NULL DEFAULT '',
  `last_message_id` varchar(255) DEFAULT NULL,
  `last_message_text` text NOT NULL,
  `last_message_time` datetime DEFAULT NULL,
  `message_count` int NOT NULL DEFAULT 0,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bot_conversation_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_message` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `message_id` varchar(255) DEFAULT NULL,
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
  KEY `idx_bot_message_self_message` (`self_id`, `message_id`),
  KEY `idx_bot_message_target` (`self_id`, `message_type`, `target_id`),
  KEY `idx_message_event_time` (`event_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_send_log` (
  `id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL,
  `target_type` varchar(32) NOT NULL,
  `target_id` varchar(64) NOT NULL,
  `action` varchar(64) NOT NULL,
  `message_text` text NOT NULL,
  `params` longtext DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `echo` varchar(80) DEFAULT NULL,
  `message_id` varchar(255) DEFAULT NULL,
  `error_message` varchar(500) DEFAULT NULL,
  `response` longtext DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_bot_send_log_target` (`self_id`, `target_type`, `target_id`),
  KEY `idx_bot_send_log_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_allowlist` (
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
  KEY `idx_bot_allowlist_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_blocklist` (
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
  KEY `idx_bot_blocklist_target` (`self_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_dedupe` (
  `id` bigint NOT NULL,
  `event_key` varchar(255) NOT NULL,
  `expire_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_dedupe_event_key` (`event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `plugin_task` (
  `id` bigint NOT NULL,
  `plugin_id` bigint NOT NULL,
  `installation_id` bigint NOT NULL,
  `task_key` varchar(128) NOT NULL,
  `task_name` varchar(128) NOT NULL,
  `handler_name` varchar(128) NOT NULL,
  `description` text DEFAULT NULL,
  `default_cron` varchar(64) NOT NULL,
  `cron_expression` varchar(64) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `timeout_ms` int NOT NULL,
  `runtime_status` varchar(32) NOT NULL DEFAULT 'idle',
  `last_run_id` bigint DEFAULT NULL,
  `last_run_at` datetime DEFAULT NULL,
  `last_status` varchar(32) DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `last_duration_ms` int DEFAULT NULL,
  `next_run_at` datetime DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plugin_task` (`installation_id`, `task_key`),
  KEY `idx_plugin_task_plugin` (`plugin_id`),
  KEY `idx_plugin_task_enabled` (`enabled`),
  KEY `idx_plugin_task_status` (`runtime_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `plugin_task_run` (
  `id` bigint NOT NULL,
  `task_id` bigint NOT NULL,
  `plugin_id` bigint NOT NULL,
  `installation_id` bigint NOT NULL,
  `task_key` varchar(128) NOT NULL,
  `trigger_type` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL,
  `job_id` varchar(191) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `safe_summary` json DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_plugin_task_run_task_time` (`task_id`, `create_time`),
  KEY `idx_plugin_task_run_plugin_time` (`plugin_id`, `create_time`),
  KEY `idx_plugin_task_run_status_time` (`status`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `connection_mode` varchar(32) NOT NULL DEFAULT ''reverse-ws''',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'connection_mode'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `official_app_id` varchar(64) DEFAULT NULL AFTER `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'official_app_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `access_token` varchar(255) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'access_token'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD UNIQUE KEY `uk_bot_account_official_app_id` (`official_app_id`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND index_name = 'uk_bot_account_official_app_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `napcat_login_password_secret` varchar(1024) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'napcat_login_password_secret'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `official_app_secret_ciphertext` varchar(1024) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'official_app_secret_ciphertext'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `client_role` varchar(32) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'client_role'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `last_connected_at` datetime DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'last_connected_at'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `last_heartbeat_at` datetime DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'last_heartbeat_at'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_account` ADD COLUMN `last_error` varchar(500) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'last_error'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `bot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
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
       FROM `bot_account` `account`
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
    AND table_name = 'bot_account'
    AND column_name = 'command_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `bot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
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
       FROM `bot_account` `account`
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
    AND table_name = 'bot_account'
    AND column_name = 'rule_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'INSERT INTO `bot_account_ability` (`id`, `account_id`, `self_id`, `ability_type`, `ability_key`, `is_deleted`)
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
       FROM `bot_account` `account`
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
    AND table_name = 'bot_account'
    AND column_name = 'event_plugin_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `bot_rule` DROP COLUMN `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_rule'
    AND column_name = 'self_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `bot_command` DROP COLUMN `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_command'
    AND column_name = 'self_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `bot_account` DROP COLUMN `command_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'command_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `bot_account` DROP COLUMN `rule_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'rule_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `bot_account` DROP COLUMN `event_plugin_bindings`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_account'
    AND column_name = 'event_plugin_bindings'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_allowlist` ADD COLUMN `user_id` varchar(64) NOT NULL DEFAULT '''' AFTER `target_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_allowlist'
    AND column_name = 'user_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_allowlist` ADD COLUMN `precise_user` tinyint(1) NOT NULL DEFAULT 0 AFTER `user_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_allowlist'
    AND column_name = 'precise_user'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_blocklist` ADD COLUMN `user_id` varchar(64) NOT NULL DEFAULT '''' AFTER `target_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_blocklist'
    AND column_name = 'user_id'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

SET @bot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `bot_blocklist` ADD COLUMN `precise_user` tinyint(1) NOT NULL DEFAULT 0 AFTER `user_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bot_blocklist'
    AND column_name = 'precise_user'
);
PREPARE bot_stmt FROM @bot_sql;
EXECUTE bot_stmt;
DEALLOCATE PREPARE bot_stmt;

INSERT INTO `bot_config` (`id`, `config_key`, `config_value`, `remark`)
VALUES
  (2041700000000200501, 'permission.allowlistEnabled', 'false', 'Bot 白名单总开关'),
  (2041700000000200502, 'permission.blocklistEnabled', 'true', 'Bot 黑名单总开关')
ON DUPLICATE KEY UPDATE
  `config_key` = VALUES(`config_key`);

INSERT INTO `bot_command` (`id`, `code`, `name`, `aliases`, `prefixes`, `plugin_key`, `operation_key`, `parser_key`, `target_type`, `default_params`, `reply_template`, `error_template`, `enabled`, `priority`, `cooldown_ms`, `remark`)
VALUES
  (2041700000000300501, 'ff14_price', 'FF14 查价', '["查价","price","ff14price"]', '["/","!","！"]', 'ff14-market', 'ff14.market.price', 'ff14Price', 'all', '{"language":"chs","world":"中国"}', '', 'FF14 查价失败：{{error}}', 1, 0, 1500, '默认示例命令；请在账号配置中绑定后启用'),
  (2041700000000300502, 'fflogs_character', 'FFLogs 查询', '["fflogs","logs","查logs","查log"]', '["/","!","！"]', 'fflogs', 'fflogs.character.summary', 'fflogsCharacter', 'all', '{"serverRegion":"CN"}', '', 'FFLogs 查询失败：{{error}}', 1, 0, 3000, '查询 FFLogs 角色公开排名；带高难任务时返回最近10次记录；格式：/fflogs 角色名 服务器 [高难任务]'),
  (2041700000000300503, 'bangdream_song', 'BangDream 查曲', '["查曲","bd","bangdream","bandori","邦邦","邦邦查歌"]', '["/","!","！"]', 'bangdream', 'bangdream.song.search', 'plain', 'all', '{}', '', 'BangDream 查曲失败：{{error}}', 1, 0, 1500, '查询 BanG Dream 歌曲信息；格式：/查曲 歌曲名 或 /查曲 歌曲ID'),
  (2041700000000300504, 'bangdream_song_chart', 'BangDream 查谱面', '["查谱面","谱面","bd谱面"]', '["/","!","！"]', 'bangdream', 'bangdream.song.chart', 'plain', 'all', '{}', '', 'BangDream 查谱面失败：{{error}}', 1, 0, 1500, '查询歌曲谱面；格式：/查谱面 歌曲ID [难度]'),
  (2041700000000300505, 'bangdream_song_random', 'BangDream 随机曲', '["随机曲","随机","bd随机"]', '["/","!","！"]', 'bangdream', 'bangdream.song.random', 'plain', 'all', '{}', '', 'BangDream 随机曲失败：{{error}}', 1, 0, 1500, '按关键词随机歌曲；格式：/随机曲 [关键词]'),
  (2041700000000300506, 'bangdream_song_meta', 'BangDream 分数表', '["查询分数表","查分数表","查询分数榜","查分数榜","bd分数表"]', '["/","!","！"]', 'bangdream', 'bangdream.song.meta', 'plain', 'all', '{}', '', 'BangDream 分数表失败：{{error}}', 1, 0, 1500, '查询歌曲分数榜；格式：/查询分数表 [服务器]'),
  (2041700000000300507, 'bangdream_card', 'BangDream 查卡', '["查卡","查卡牌","bd查卡"]', '["/","!","！"]', 'bangdream', 'bangdream.card.search', 'plain', 'all', '{}', '', 'BangDream 查卡失败：{{error}}', 1, 0, 1500, '查询卡牌信息；格式：/查卡 卡牌关键词 或 /查卡 卡牌ID'),
  (2041700000000300508, 'bangdream_card_illustration', 'BangDream 查卡面', '["查卡面","查卡插画","查插画","bd卡面"]', '["/","!","！"]', 'bangdream', 'bangdream.card.illustration', 'plain', 'all', '{}', '', 'BangDream 查卡面失败：{{error}}', 1, 0, 1500, '查询卡牌插画；格式：/查卡面 卡牌ID'),
  (2041700000000300509, 'bangdream_character', 'BangDream 查角色', '["查角色","bd角色"]', '["/","!","！"]', 'bangdream', 'bangdream.character.search', 'plain', 'all', '{}', '', 'BangDream 查角色失败：{{error}}', 1, 0, 1500, '查询角色信息；格式：/查角色 角色关键词 或 /查角色 角色ID'),
  (2041700000000300510, 'bangdream_event', 'BangDream 查活动', '["查活动","bd活动"]', '["/","!","！"]', 'bangdream', 'bangdream.event.search', 'plain', 'all', '{}', '', 'BangDream 查活动失败：{{error}}', 1, 0, 1500, '查询活动信息；格式：/查活动 活动关键词 或 /查活动 活动ID'),
  (2041700000000300511, 'bangdream_event_stage', 'BangDream 查试炼', '["查试炼","查stage","查舞台","查festival","查5v5"]', '["/","!","！"]', 'bangdream', 'bangdream.event.stage', 'plain', 'all', '{}', '', 'BangDream 查试炼失败：{{error}}', 1, 0, 1500, '查询活动试炼；格式：/查试炼 [活动ID] [-m]'),
  (2041700000000300512, 'bangdream_player', 'BangDream 查玩家', '["查玩家","查询玩家","bd玩家"]', '["/","!","！"]', 'bangdream', 'bangdream.player.search', 'plain', 'all', '{}', '', 'BangDream 查玩家失败：{{error}}', 1, 0, 1500, '查询玩家信息；格式：/查玩家 玩家ID [服务器]'),
  (2041700000000300513, 'bangdream_gacha', 'BangDream 查卡池', '["查卡池","bd卡池"]', '["/","!","！"]', 'bangdream', 'bangdream.gacha.search', 'plain', 'all', '{}', '', 'BangDream 查卡池失败：{{error}}', 1, 0, 1500, '查询卡池信息；格式：/查卡池 卡池ID'),
  (2041700000000300514, 'bangdream_gacha_simulate', 'BangDream 抽卡模拟', '["抽卡模拟","bd抽卡"]', '["/","!","！"]', 'bangdream', 'bangdream.gacha.simulate', 'plain', 'all', '{}', '', 'BangDream 抽卡模拟失败：{{error}}', 1, 0, 3000, '模拟抽卡；格式：/抽卡模拟 [次数] [卡池ID]'),
  (2041700000000300515, 'bangdream_cutoff_detail', 'BangDream ycx', '["ycx","预测线","查档线","bd档线"]', '["/","!","！"]', 'bangdream', 'bangdream.cutoff.detail', 'plain', 'all', '{}', '', 'BangDream ycx 失败：{{error}}', 1, 0, 3000, '查询指定档位预测线；格式：/ycx 档位 [活动ID] [服务器]'),
  (2041700000000300516, 'bangdream_cutoff_all', 'BangDream ycxall', '["ycxall","myycx","全部档线"]', '["/","!","！"]', 'bangdream', 'bangdream.cutoff.all', 'plain', 'all', '{}', '', 'BangDream ycxall 失败：{{error}}', 1, 0, 3000, '查询所有档位预测线；格式：/ycxall [活动ID] [服务器]'),
  (2041700000000300517, 'bangdream_cutoff_recent', 'BangDream lsycx', '["lsycx","历史档线","近期档线"]', '["/","!","！"]', 'bangdream', 'bangdream.cutoff.recent', 'plain', 'all', '{}', '', 'BangDream lsycx 失败：{{error}}', 1, 0, 3000, '查询同类型活动档线；格式：/lsycx 档位 [活动ID] [服务器]'),
  (2041700000000300518, 'natmap_port', 'NATMap 动态端口', '["natmap","动态端口","公网端口"]', '["/","!","！"]', 'natmap-port', 'natmap.port.current', 'plain', 'all', '{}', '', 'NATMap 实时状态暂不可用，请稍后再试。', 1, 0, 5000, '只读查询已授权 TCP NATMap 通道；格式：/natmap [通道名称]')
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `aliases` = VALUES(`aliases`),
  `prefixes` = VALUES(`prefixes`),
  `plugin_key` = VALUES(`plugin_key`),
  `operation_key` = VALUES(`operation_key`),
  `parser_key` = VALUES(`parser_key`),
  `target_type` = VALUES(`target_type`),
  `default_params` = VALUES(`default_params`),
  `reply_template` = VALUES(`reply_template`),
  `error_template` = VALUES(`error_template`),
  `enabled` = VALUES(`enabled`),
  `priority` = VALUES(`priority`),
  `cooldown_ms` = VALUES(`cooldown_ms`),
  `remark` = VALUES(`remark`),
  `is_deleted` = 0;

DELETE `legacy`
FROM `admin_dict` AS `legacy`
INNER JOIN `admin_dict` AS `canonical`
  ON `canonical`.`dict_code` = 'PLUGIN_TRIGGER_MODE'
  AND `canonical`.`value` = `legacy`.`value`
WHERE `legacy`.`dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

DELETE `duplicate`
FROM `admin_dict` AS `duplicate`
INNER JOIN `admin_dict` AS `retained`
  ON `retained`.`value` = `duplicate`.`value`
  AND `retained`.`dict_code` IN (
    'QQBOT_PLUGIN_TRIGGER_MODE',
    'BOT_PLUGIN_TRIGGER_MODE'
  )
  AND `retained`.`id` < `duplicate`.`id`
WHERE `duplicate`.`dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

UPDATE `admin_dict`
SET `dict_code` = 'PLUGIN_TRIGGER_MODE'
WHERE `dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000300401, 'PLUGIN_TRIGGER_MODE', '命令', 'command', NULL, 1, 1),
  (2041700000000300402, 'PLUGIN_TRIGGER_MODE', '事件', 'event', NULL, 2, 1)
ON DUPLICATE KEY UPDATE
  `dict_code` = VALUES(`dict_code`),
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
  (2041700000000301401, 'BANGDREAM_SERVER_ALIAS', 'cn', 'cn', NULL, 1, 1),
  (2041700000000301402, 'BANGDREAM_SERVER_ALIAS', '国服', 'cn', NULL, 2, 1),
  (2041700000000301403, 'BANGDREAM_SERVER_ALIAS', '中服', 'cn', NULL, 3, 1),
  (2041700000000301404, 'BANGDREAM_SERVER_ALIAS', '中国', 'cn', NULL, 4, 1),
  (2041700000000301405, 'BANGDREAM_SERVER_ALIAS', 'jp', 'jp', NULL, 5, 1),
  (2041700000000301406, 'BANGDREAM_SERVER_ALIAS', '日服', 'jp', NULL, 6, 1),
  (2041700000000301407, 'BANGDREAM_SERVER_ALIAS', 'tw', 'tw', NULL, 7, 1),
  (2041700000000301408, 'BANGDREAM_SERVER_ALIAS', '台服', 'tw', NULL, 8, 1),
  (2041700000000301409, 'BANGDREAM_SERVER_ALIAS', 'en', 'en', NULL, 9, 1),
  (2041700000000301410, 'BANGDREAM_SERVER_ALIAS', '国际服', 'en', NULL, 10, 1),
  (2041700000000301411, 'BANGDREAM_SERVER_ALIAS', 'kr', 'kr', NULL, 11, 1),
  (2041700000000301412, 'BANGDREAM_SERVER_ALIAS', '韩服', 'kr', NULL, 12, 1),
  (2041700000000301501, 'BANGDREAM_DIFFICULTY_ALIAS', 'easy', 'easy', NULL, 1, 1),
  (2041700000000301502, 'BANGDREAM_DIFFICULTY_ALIAS', 'ez', 'easy', NULL, 2, 1),
  (2041700000000301503, 'BANGDREAM_DIFFICULTY_ALIAS', '简单', 'easy', NULL, 3, 1),
  (2041700000000301504, 'BANGDREAM_DIFFICULTY_ALIAS', 'normal', 'normal', NULL, 4, 1),
  (2041700000000301505, 'BANGDREAM_DIFFICULTY_ALIAS', 'nm', 'normal', NULL, 5, 1),
  (2041700000000301506, 'BANGDREAM_DIFFICULTY_ALIAS', '普通', 'normal', NULL, 6, 1),
  (2041700000000301507, 'BANGDREAM_DIFFICULTY_ALIAS', 'hard', 'hard', NULL, 7, 1),
  (2041700000000301508, 'BANGDREAM_DIFFICULTY_ALIAS', 'hd', 'hard', NULL, 8, 1),
  (2041700000000301509, 'BANGDREAM_DIFFICULTY_ALIAS', '困难', 'hard', NULL, 9, 1),
  (2041700000000301510, 'BANGDREAM_DIFFICULTY_ALIAS', 'expert', 'expert', NULL, 10, 1),
  (2041700000000301511, 'BANGDREAM_DIFFICULTY_ALIAS', 'ex', 'expert', NULL, 11, 1),
  (2041700000000301512, 'BANGDREAM_DIFFICULTY_ALIAS', '专家', 'expert', NULL, 12, 1),
  (2041700000000301513, 'BANGDREAM_DIFFICULTY_ALIAS', 'special', 'special', NULL, 13, 1),
  (2041700000000301514, 'BANGDREAM_DIFFICULTY_ALIAS', 'sp', 'special', NULL, 14, 1),
  (2041700000000301515, 'BANGDREAM_DIFFICULTY_ALIAS', '特殊', 'special', NULL, 15, 1)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = 0;

INSERT INTO `admin_dict` (`id`, `dict_code`, `label`, `value`, `children_code`, `sort`, `status`)
VALUES
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
  (2041700000000100400, 0, 'Bot', '/bot', NULL, '/bot/dashboard', NULL, 'catalog', '{"icon":"lucide:bot","order":110,"title":"Bot 管理"}', 1, 110),
  (2041700000000100401, 2041700000000100400, 'BotDashboard', '/bot/dashboard', '/bot/dashboard/list', NULL, 'Bot:Dashboard:List', 'menu', '{"icon":"lucide:gauge","title":"工作台"}', 1, 0),
  (2041700000000100402, 2041700000000100400, 'BotNapcatConnection', '/bot/napcat', '/bot/account/list', NULL, 'Bot:Account:List', 'menu', '{"icon":"lucide:radio-receiver","title":"NapCat 连接"}', 1, 1),
  (2041700000000100410, 2041700000000100400, 'BotNapcatConfig', '/bot/napcat/config', '/bot/account/config', NULL, 'Bot:Account:Config', 'menu', '{"activePath":"/bot/napcat","hideInMenu":true,"title":"NapCat 功能配置"}', 1, 0),
  (2041700000000100412, 2041700000000100400, 'BotNapcatWebui', '/bot/napcat/:accountId/webui', '/bot/account/napcat-webui/index', NULL, 'Bot:Account:WebUI', 'menu', '{"activePath":"/bot/napcat","hideInMenu":true,"title":"NapCat WebUI"}', 1, 0),
  (2041700000000100421, 2041700000000100400, 'BotTencentConnection', '/bot/tencent', '/bot/tencent/list', NULL, 'Bot:Tencent:List', 'menu', '{"icon":"lucide:cloud-cog","title":"Tencent 连接"}', 1, 2),
  (2041700000000120531, 2041700000000100421, 'BotTencentCreate', NULL, NULL, NULL, 'Bot:Tencent:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120532, 2041700000000100421, 'BotTencentEdit', NULL, NULL, NULL, 'Bot:Tencent:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120533, 2041700000000100421, 'BotTencentDelete', NULL, NULL, NULL, 'Bot:Tencent:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120534, 2041700000000100421, 'BotTencentReconnect', NULL, NULL, NULL, 'Bot:Tencent:Reconnect', 'button', '{"title":"重连"}', 1, 0),
  (2041700000000120535, 2041700000000100421, 'BotTencentPlugin', NULL, NULL, NULL, 'Bot:Tencent:Plugin', 'button', '{"title":"插件能力"}', 1, 0),
  (2041700000000120536, 2041700000000100421, 'BotTencentMenuSync', NULL, NULL, NULL, 'Bot:Tencent:MenuSync', 'button', '{"title":"同步官方菜单"}', 1, 0),
  (2041700000000120537, 2041700000000100421, 'BotTencentWebhookUrl', NULL, NULL, NULL, 'Bot:Tencent:WebhookUrl', 'button', '{"title":"复制 Webhook 回调"}', 1, 0),
  (2041700000000120401, 2041700000000100402, 'BotAccountCreate', NULL, NULL, NULL, 'Bot:Account:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120402, 2041700000000100402, 'BotAccountEdit', NULL, NULL, NULL, 'Bot:Account:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120403, 2041700000000100402, 'BotAccountDelete', NULL, NULL, NULL, 'Bot:Account:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120404, 2041700000000100402, 'BotAccountKick', NULL, NULL, NULL, 'Bot:Account:Kick', 'button', '{"title":"断开连接"}', 1, 0),
  (2041700000000120405, 2041700000000100402, 'BotAccountRefreshLogin', NULL, NULL, NULL, 'Bot:Account:RefreshLogin', 'button', '{"title":"更新登录"}', 1, 0),
  (2041700000000120406, 2041700000000100402, 'BotAccountConfigButton', NULL, NULL, NULL, 'Bot:Account:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000120407, 2041700000000100402, 'BotAccountWebUI', NULL, NULL, NULL, 'Bot:Account:WebUI', 'button', '{"title":"NapCat WebUI"}', 1, 0),
  (2041700000000100403, 2041700000000100400, 'BotRule', '/bot/rule', '/bot/rule/list', NULL, 'Bot:Rule:List', 'menu', '{"icon":"lucide:workflow","title":"自动回复规则"}', 1, 3),
  (2041700000000120411, 2041700000000100403, 'BotRuleCreate', NULL, NULL, NULL, 'Bot:Rule:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120412, 2041700000000100403, 'BotRuleEdit', NULL, NULL, NULL, 'Bot:Rule:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120413, 2041700000000100403, 'BotRuleDelete', NULL, NULL, NULL, 'Bot:Rule:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120414, 2041700000000100403, 'BotRuleToggle', NULL, NULL, NULL, 'Bot:Rule:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000100408, 2041700000000100400, 'BotCommand', '/bot/command', '/bot/command/list', NULL, 'Bot:Command:List', 'menu', '{"icon":"lucide:square-terminal","title":"在线命令"}', 1, 4),
  (2041700000000120441, 2041700000000100408, 'BotCommandCreate', NULL, NULL, NULL, 'Bot:Command:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120442, 2041700000000100408, 'BotCommandEdit', NULL, NULL, NULL, 'Bot:Command:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120443, 2041700000000100408, 'BotCommandDelete', NULL, NULL, NULL, 'Bot:Command:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120444, 2041700000000100408, 'BotCommandToggle', NULL, NULL, NULL, 'Bot:Command:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000120445, 2041700000000100408, 'BotCommandTest', NULL, NULL, NULL, 'Bot:Command:Test', 'button', '{"title":"测试命令"}', 1, 0),
  (2041700000000100404, 2041700000000100400, 'BotConversation', '/bot/conversation', '/bot/conversation/list', NULL, 'Bot:Conversation:List', 'menu', '{"icon":"lucide:messages-square","title":"会话管理"}', 1, 5),
  (2041700000000100405, 2041700000000100400, 'BotMessage', '/bot/message', '/bot/message/list', NULL, 'Bot:Message:List', 'menu', '{"icon":"lucide:message-square-text","title":"消息日志"}', 1, 6),
  (2041700000000100406, 2041700000000100400, 'BotSendLog', '/bot/send-log', '/bot/send-log/list', NULL, 'Bot:SendLog:List', 'menu', '{"icon":"lucide:send","title":"发送日志"}', 1, 7),
  (2041700000000120421, 2041700000000100406, 'BotSendPrivate', NULL, NULL, NULL, 'Bot:Send:Private', 'button', '{"title":"发送私聊"}', 1, 0),
  (2041700000000120422, 2041700000000100406, 'BotSendGroup', NULL, NULL, NULL, 'Bot:Send:Group', 'button', '{"title":"发送群聊"}', 1, 0),
  (2041700000000100407, 2041700000000100400, 'BotPermission', '/bot/permission', '/bot/permission/list', NULL, 'Bot:Permission:List', 'menu', '{"icon":"lucide:shield-check","title":"权限名单"}', 1, 8),
  (2041700000000120431, 2041700000000100407, 'BotPermissionCreate', NULL, NULL, NULL, 'Bot:Permission:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120432, 2041700000000100407, 'BotPermissionEdit', NULL, NULL, NULL, 'Bot:Permission:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120433, 2041700000000100407, 'BotPermissionDelete', NULL, NULL, NULL, 'Bot:Permission:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000100422, 0, 'PluginPlatform', '/plugin-platform', NULL, '/plugin-platform/plugins', NULL, 'catalog', '{"icon":"lucide:blocks","order":111,"title":"插件平台"}', 1, 111),
  (2041700000000100409, 2041700000000100422, 'PluginPlatformPlugins', '/plugin-platform/plugins', '/plugin-platform/plugin/list', NULL, 'PluginPlatform:Plugin:List', 'menu', '{"icon":"lucide:plug","title":"插件管理"}', 1, 0),
  (2041700000000120521, 2041700000000100409, 'PluginPlatformPluginInstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Install', 'button', '{"title":"安装"}', 1, 0),
  (2041700000000120522, 2041700000000100409, 'PluginPlatformPluginEnable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Enable', 'button', '{"title":"启用"}', 1, 0),
  (2041700000000120523, 2041700000000100409, 'PluginPlatformPluginDisable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Disable', 'button', '{"title":"停用"}', 1, 0),
  (2041700000000120524, 2041700000000100409, 'PluginPlatformPluginUpgrade', NULL, NULL, NULL, 'PluginPlatform:Plugin:Upgrade', 'button', '{"title":"升级"}', 1, 0),
  (2041700000000120525, 2041700000000100409, 'PluginPlatformPluginUninstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Uninstall', 'button', '{"title":"卸载"}', 1, 0),
  (2041700000000120526, 2041700000000100409, 'PluginPlatformPluginConfig', NULL, NULL, NULL, 'PluginPlatform:Plugin:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000100411, 2041700000000100422, 'PluginPlatformTasks', '/plugin-platform/tasks', '/plugin-platform/task/list', NULL, 'PluginPlatform:Task:List', 'menu', '{"icon":"lucide:calendar-clock","title":"定时任务"}', 1, 1),
  (2041700000000120451, 2041700000000100411, 'PluginPlatformTaskUpdateCron', NULL, NULL, NULL, 'PluginPlatform:Task:UpdateCron', 'button', '{"title":"修改 Cron"}', 1, 0),
  (2041700000000120452, 2041700000000100411, 'PluginPlatformTaskEnable', NULL, NULL, NULL, 'PluginPlatform:Task:Enable', 'button', '{"title":"启用"}', 1, 0),
  (2041700000000120453, 2041700000000100411, 'PluginPlatformTaskDisable', NULL, NULL, NULL, 'PluginPlatform:Task:Disable', 'button', '{"title":"停用"}', 1, 0),
  (2041700000000120454, 2041700000000100411, 'PluginPlatformTaskRun', NULL, NULL, NULL, 'PluginPlatform:Task:Run', 'button', '{"title":"手动运行"}', 1, 0),
  (2041700000000120455, 2041700000000100411, 'PluginPlatformTaskRunLog', NULL, NULL, NULL, 'PluginPlatform:Task:RunLog', 'button', '{"title":"运行记录"}', 1, 0),
  (2041700000000120481, 2041700000000100410, 'BotAccountMessagePushList', NULL, NULL, NULL, 'Bot:Account:MessagePush:List', 'button', '{"title":"common.list"}', 1, 0),
  (2041700000000120482, 2041700000000100410, 'BotAccountMessagePushCreate', NULL, NULL, NULL, 'Bot:Account:MessagePush:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120483, 2041700000000100410, 'BotAccountMessagePushUpdate', NULL, NULL, NULL, 'Bot:Account:MessagePush:Update', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120484, 2041700000000100410, 'BotAccountMessagePushDelete', NULL, NULL, NULL, 'Bot:Account:MessagePush:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120485, 2041700000000100410, 'BotAccountMessagePushToggle', NULL, NULL, NULL, 'Bot:Account:MessagePush:Toggle', 'button', '{"title":"启停"}', 1, 0)
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

DELETE `role_menu`
FROM `admin_role_menu` AS `role_menu`
INNER JOIN `admin_menu` AS `menu`
  ON `menu`.`id` = `role_menu`.`menu_id`
WHERE `menu`.`name` LIKE 'QqBot%'
   OR `menu`.`path` = '/qqbot'
   OR `menu`.`path` LIKE '/qqbot/%'
   OR `menu`.`component` LIKE '/qqbot/%'
   OR `menu`.`auth_code` LIKE 'QqBot:%'
   OR `menu`.`auth_code` LIKE 'Bot:PluginTask:%'
   OR `menu`.`path` IN ('/bot/plugin', '/bot/plugin-task')
   OR `menu`.`path` LIKE '/bot/plugin-platform/%';

DELETE FROM `admin_menu`
WHERE `name` LIKE 'QqBot%'
   OR `path` = '/qqbot'
   OR `path` LIKE '/qqbot/%'
   OR `component` LIKE '/qqbot/%'
   OR `auth_code` LIKE 'QqBot:%'
   OR `auth_code` LIKE 'Bot:PluginTask:%'
   OR `path` IN ('/bot/plugin', '/bot/plugin-task')
   OR `path` LIKE '/bot/plugin-platform/%';

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu
  ON menu.`name` LIKE 'Bot%'
  OR menu.`name` LIKE 'PluginPlatform%'
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100400
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000100401,
  2041700000000100402,
  2041700000000100403,
  2041700000000100404,
  2041700000000100405,
  2041700000000100406,
  2041700000000100407,
  2041700000000100408,
  2041700000000100410,
  2041700000000100412,
  2041700000000100421
);

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100410
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000120481,
  2041700000000120482,
  2041700000000120483,
  2041700000000120484,
  2041700000000120485
);

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100400
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` = 2041700000000100410;

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100422
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000100409,
  2041700000000100411,
  2041700000000120451,
  2041700000000120452,
  2041700000000120453,
  2041700000000120454,
  2041700000000120455
);

CREATE TABLE IF NOT EXISTS `message_subscription` (
  `id` bigint NOT NULL, `name` varchar(100) NOT NULL, `subscriber_key` varchar(64) NOT NULL,
  `template_binding_digest` char(64) NOT NULL, `source_config` json NOT NULL, `source_config_digest` char(64) NOT NULL, `active_key` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1, `remark` varchar(500) DEFAULT NULL, `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_message_subscription_active_key` (`active_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_template` (
  `id` bigint NOT NULL, `name` varchar(100) NOT NULL, `source_key` varchar(128) NOT NULL, `content` text NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1, `remark` varchar(500) DEFAULT NULL, `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_subscription_template` (
  `subscription_id` bigint NOT NULL, `template_id` bigint NOT NULL, `sort_order` int unsigned NOT NULL,
  PRIMARY KEY (`subscription_id`, `template_id`), UNIQUE KEY `uk_message_subscription_template_order` (`subscription_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_message_publish_binding` (
  `id` bigint NOT NULL, `subscription_id` bigint NOT NULL, `account_id` bigint NOT NULL, `self_id` varchar(64) NOT NULL,
  `active_key` varchar(255) DEFAULT NULL, `enabled` tinyint(1) NOT NULL DEFAULT 1, `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bot_message_publish_binding_active_key` (`active_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_message_publish_target` (
  `id` bigint NOT NULL, `binding_id` bigint NOT NULL, `target_type` varchar(16) NOT NULL, `target_id` varchar(64) NOT NULL, `target_name` varchar(120) DEFAULT NULL,
  `active_key` varchar(300) DEFAULT NULL, `enabled` tinyint(1) NOT NULL DEFAULT 1, `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bot_message_publish_target_active_key` (`active_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_event` (
  `id` bigint NOT NULL, `event_id` varchar(128) NOT NULL, `source_key` varchar(128) NOT NULL, `resource_key` varchar(128) NOT NULL, `occurred_at` datetime(6) NOT NULL,
  `payload` json NOT NULL, `fanout_status` varchar(32) NOT NULL DEFAULT 'accepted', `fanout_attempt_count` int unsigned NOT NULL DEFAULT 0,
  `next_fanout_at` datetime(6) DEFAULT NULL, `fanout_lease_until` datetime(6) DEFAULT NULL, `last_error_code` varchar(64) DEFAULT NULL, `last_error_message` varchar(500) DEFAULT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_message_event_event_id` (`event_id`), KEY `idx_message_event_dispatch` (`fanout_status`, `next_fanout_at`), KEY `idx_message_event_lease` (`fanout_lease_until`), KEY `idx_message_event_source_resource_order` (`source_key`, `resource_key`, `occurred_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_message_delivery` (
  `id` bigint NOT NULL, `message_event_id` bigint NOT NULL, `publish_target_id` bigint NOT NULL, `binding_id` bigint NOT NULL, `subscription_id` bigint NOT NULL,
  `self_id` varchar(64) NOT NULL, `target_type` varchar(16) NOT NULL, `target_id` varchar(64) NOT NULL, `template_id` bigint NOT NULL,
  `template_content` text NOT NULL, `variable_snapshot` json NOT NULL, `rendered_message` text NOT NULL, `status` varchar(32) NOT NULL, `attempt_count` int unsigned NOT NULL DEFAULT 0,
  `next_attempt_at` datetime(6) DEFAULT NULL, `processing_lease_until` datetime(6) DEFAULT NULL, `send_log_id` bigint DEFAULT NULL, `last_error_code` varchar(64) DEFAULT NULL, `last_error_message` varchar(500) DEFAULT NULL, `expires_at` datetime(6) NOT NULL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_bot_message_delivery_event_target_template` (`message_event_id`, `publish_target_id`, `template_id`), KEY `idx_bot_message_delivery_dispatch` (`status`, `next_attempt_at`), KEY `idx_bot_message_delivery_lease` (`processing_lease_until`), KEY `idx_bot_message_delivery_history` (`subscription_id`, `message_event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `station_notice_message_binding` (
  `id` bigint NOT NULL, `subscription_id` bigint NOT NULL, `title` varchar(255) NOT NULL, `notify_role_code` varchar(64) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1, `active_key` varchar(255) DEFAULT NULL, `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`), UNIQUE KEY `uk_station_notice_message_binding_active_key` (`active_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `message_template` (`id`, `name`, `source_key`, `content`, `enabled`, `remark`, `is_deleted`)
SELECT 2041700000000200601, 'STUN 映射端口变更默认模板', 'network.stun.mapping-port-changed', '当前STUN的端口已变更为${{endpoint}}', 1, '系统默认模板', 0
WHERE NOT EXISTS (
  SELECT 1 FROM `message_template`
  WHERE `source_key` = 'network.stun.mapping-port-changed' AND `name` = 'STUN 映射端口变更默认模板' AND `is_deleted` = 0
);

INSERT INTO `message_template` (`id`, `name`, `source_key`, `content`, `enabled`, `remark`, `is_deleted`)
SELECT 2041700000000200602, 'TCP NATMap 端点变更默认模板', 'network.tcp.natmap-endpoint-changed', '当前 TCP NATMap 端点已变更为 ${{endpoint}}', 1, '系统默认模板', 0
WHERE NOT EXISTS (
  SELECT 1 FROM `message_template`
  WHERE `source_key` = 'network.tcp.natmap-endpoint-changed' AND `name` = 'TCP NATMap 端点变更默认模板' AND `is_deleted` = 0
);

INSERT INTO `admin_menu` (`id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`) VALUES
  (2041700000000100420,0,'MessageManagement','/message-management',NULL,'/message-management/subscription',NULL,'catalog','{"icon":"lucide:messages-square","order":109,"title":"消息管理"}',1,109),
  (2041700000000100414,2041700000000100420,'MessageManagementTemplate','/message-management/template','/message-management/template/list',NULL,'MessageManagement:Template:List','menu','{"icon":"lucide:message-square-plus","title":"消息模板"}',1,0),
  (2041700000000100413,2041700000000100420,'MessageManagementSubscription','/message-management/subscription','/message-management/subscription/list',NULL,'MessageManagement:Subscription:List','menu','{"icon":"lucide:bell-ring","title":"消息订阅"}',1,1),
  (2041700000000100423,2041700000000100420,'MessageManagementStationNoticeSubscriber','/message-management/subscribers/station-notice','/message-management/subscribers/station-notice/list',NULL,'MessageManagement:Push:List','menu','{"icon":"lucide:inbox","title":"站内信投递"}',1,2),
  (2041700000000120461,2041700000000100413,'MessageManagementSubscriptionList',NULL,NULL,NULL,'MessageManagement:Subscription:List','button','{"title":"common.list"}',1,0),(2041700000000120462,2041700000000100413,'MessageManagementSubscriptionCreate',NULL,NULL,NULL,'MessageManagement:Subscription:Create','button','{"title":"common.create"}',1,0),(2041700000000120463,2041700000000100413,'MessageManagementSubscriptionUpdate',NULL,NULL,NULL,'MessageManagement:Subscription:Update','button','{"title":"common.edit"}',1,0),(2041700000000120464,2041700000000100413,'MessageManagementSubscriptionDelete',NULL,NULL,NULL,'MessageManagement:Subscription:Delete','button','{"title":"common.delete"}',1,0),(2041700000000120465,2041700000000100413,'MessageManagementSubscriptionToggle',NULL,NULL,NULL,'MessageManagement:Subscription:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120471,2041700000000100414,'MessageManagementTemplateList',NULL,NULL,NULL,'MessageManagement:Template:List','button','{"title":"common.list"}',1,0),(2041700000000120472,2041700000000100414,'MessageManagementTemplateCreate',NULL,NULL,NULL,'MessageManagement:Template:Create','button','{"title":"common.create"}',1,0),(2041700000000120473,2041700000000100414,'MessageManagementTemplateUpdate',NULL,NULL,NULL,'MessageManagement:Template:Update','button','{"title":"common.edit"}',1,0),(2041700000000120474,2041700000000100414,'MessageManagementTemplateDelete',NULL,NULL,NULL,'MessageManagement:Template:Delete','button','{"title":"common.delete"}',1,0),(2041700000000120475,2041700000000100414,'MessageManagementTemplateToggle',NULL,NULL,NULL,'MessageManagement:Template:Toggle','button','{"title":"启停"}',1,0),(2041700000000120476,2041700000000100414,'MessageManagementTemplatePreview',NULL,NULL,NULL,'MessageManagement:Template:Preview','button','{"title":"预览"}',1,0),
  (2041700000000120491,2041700000000100423,'MessageManagementPushList',NULL,NULL,NULL,'MessageManagement:Push:List','button','{"title":"common.list"}',1,0),(2041700000000120492,2041700000000100423,'MessageManagementPushCreate',NULL,NULL,NULL,'MessageManagement:Push:Create','button','{"title":"common.create"}',1,0),(2041700000000120493,2041700000000100423,'MessageManagementPushUpdate',NULL,NULL,NULL,'MessageManagement:Push:Update','button','{"title":"common.edit"}',1,0),(2041700000000120494,2041700000000100423,'MessageManagementPushDelete',NULL,NULL,NULL,'MessageManagement:Push:Delete','button','{"title":"common.delete"}',1,0),(2041700000000120495,2041700000000100423,'MessageManagementPushToggle',NULL,NULL,NULL,'MessageManagement:Push:Toggle','button','{"title":"启停"}',1,0),
  (2041700000000120481,2041700000000100410,'BotAccountMessagePushList',NULL,NULL,NULL,'Bot:Account:MessagePush:List','button','{"title":"common.list"}',1,0),(2041700000000120482,2041700000000100410,'BotAccountMessagePushCreate',NULL,NULL,NULL,'Bot:Account:MessagePush:Create','button','{"title":"common.create"}',1,0),(2041700000000120483,2041700000000100410,'BotAccountMessagePushUpdate',NULL,NULL,NULL,'Bot:Account:MessagePush:Update','button','{"title":"common.edit"}',1,0),(2041700000000120484,2041700000000100410,'BotAccountMessagePushDelete',NULL,NULL,NULL,'Bot:Account:MessagePush:Delete','button','{"title":"common.delete"}',1,0),(2041700000000120485,2041700000000100410,'BotAccountMessagePushToggle',NULL,NULL,NULL,'Bot:Account:MessagePush:Toggle','button','{"title":"启停"}',1,0)
ON DUPLICATE KEY UPDATE `pid`=VALUES(`pid`),`name`=VALUES(`name`),`path`=VALUES(`path`),`component`=VALUES(`component`),`redirect`=VALUES(`redirect`),`auth_code`=VALUES(`auth_code`),`type`=VALUES(`type`),`meta`=VALUES(`meta`),`status`=VALUES(`status`),`sort`=VALUES(`sort`),`is_deleted`=0;

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
CROSS JOIN `admin_menu` menu
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`status` = 1
  AND role.`is_deleted` = 0
  AND menu.`id` IN (
    2041700000000100420, 2041700000000100413, 2041700000000100414,
    2041700000000100423,
    2041700000000120461, 2041700000000120462, 2041700000000120463,
    2041700000000120464, 2041700000000120465, 2041700000000120471,
    2041700000000120472, 2041700000000120473, 2041700000000120474,
    2041700000000120475, 2041700000000120476,
    2041700000000120491, 2041700000000120492, 2041700000000120493,
    2041700000000120494, 2041700000000120495, 2041700000000120481,
    2041700000000120482, 2041700000000120483, 2041700000000120484,
    2041700000000120485
  )
  AND menu.`status` = 1
  AND menu.`is_deleted` = 0;

SET FOREIGN_KEY_CHECKS = 1;
