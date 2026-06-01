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
  `target_type` varchar(32) NOT NULL DEFAULT 'all',
  `target_id` varchar(64) NOT NULL DEFAULT '',
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
  `target_type` varchar(32) NOT NULL DEFAULT 'all',
  `target_id` varchar(64) NOT NULL DEFAULT '',
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

INSERT INTO `admin_menu` (`id`, `pid`, `name`, `path`, `component`, `redirect`, `auth_code`, `type`, `meta`, `status`, `sort`)
VALUES
  (2041700000000100400, 0, 'QqBot', '/qqbot', NULL, '/qqbot/dashboard', NULL, 'catalog', '{"icon":"lucide:bot","order":110,"title":"QQBot 管理"}', 1, 110),
  (2041700000000100401, 2041700000000100400, 'QqBotDashboard', '/qqbot/dashboard', '/qqbot/dashboard/list', NULL, 'QqBot:Dashboard:List', 'menu', '{"icon":"lucide:gauge","title":"工作台"}', 1, 0),
  (2041700000000100402, 2041700000000100400, 'QqBotAccount', '/qqbot/account', '/qqbot/account/list', NULL, 'QqBot:Account:List', 'menu', '{"icon":"lucide:radio-receiver","title":"账号连接"}', 1, 1),
  (2041700000000120401, 2041700000000100402, 'QqBotAccountCreate', NULL, NULL, NULL, 'QqBot:Account:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120402, 2041700000000100402, 'QqBotAccountEdit', NULL, NULL, NULL, 'QqBot:Account:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120403, 2041700000000100402, 'QqBotAccountDelete', NULL, NULL, NULL, 'QqBot:Account:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120404, 2041700000000100402, 'QqBotAccountKick', NULL, NULL, NULL, 'QqBot:Account:Kick', 'button', '{"title":"断开连接"}', 1, 0),
  (2041700000000120405, 2041700000000100402, 'QqBotAccountRefreshLogin', NULL, NULL, NULL, 'QqBot:Account:RefreshLogin', 'button', '{"title":"更新登录"}', 1, 0),
  (2041700000000100403, 2041700000000100400, 'QqBotRule', '/qqbot/rule', '/qqbot/rule/list', NULL, 'QqBot:Rule:List', 'menu', '{"icon":"lucide:workflow","title":"自动回复规则"}', 1, 2),
  (2041700000000120411, 2041700000000100403, 'QqBotRuleCreate', NULL, NULL, NULL, 'QqBot:Rule:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120412, 2041700000000100403, 'QqBotRuleEdit', NULL, NULL, NULL, 'QqBot:Rule:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120413, 2041700000000100403, 'QqBotRuleDelete', NULL, NULL, NULL, 'QqBot:Rule:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120414, 2041700000000100403, 'QqBotRuleToggle', NULL, NULL, NULL, 'QqBot:Rule:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000100404, 2041700000000100400, 'QqBotConversation', '/qqbot/conversation', '/qqbot/conversation/list', NULL, 'QqBot:Conversation:List', 'menu', '{"icon":"lucide:messages-square","title":"会话管理"}', 1, 3),
  (2041700000000100405, 2041700000000100400, 'QqBotMessage', '/qqbot/message', '/qqbot/message/list', NULL, 'QqBot:Message:List', 'menu', '{"icon":"lucide:message-square-text","title":"消息日志"}', 1, 4),
  (2041700000000100406, 2041700000000100400, 'QqBotSendLog', '/qqbot/sendLog', '/qqbot/sendLog/list', NULL, 'QqBot:SendLog:List', 'menu', '{"icon":"lucide:send","title":"发送日志"}', 1, 5),
  (2041700000000120421, 2041700000000100406, 'QqBotSendPrivate', NULL, NULL, NULL, 'QqBot:Send:Private', 'button', '{"title":"发送私聊"}', 1, 0),
  (2041700000000120422, 2041700000000100406, 'QqBotSendGroup', NULL, NULL, NULL, 'QqBot:Send:Group', 'button', '{"title":"发送群聊"}', 1, 0),
  (2041700000000100407, 2041700000000100400, 'QqBotPermission', '/qqbot/permission', '/qqbot/permission/list', NULL, 'QqBot:Permission:List', 'menu', '{"icon":"lucide:shield-check","title":"权限名单"}', 1, 6),
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

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` LIKE 'QqBot%'
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;

SET FOREIGN_KEY_CHECKS = 1;
