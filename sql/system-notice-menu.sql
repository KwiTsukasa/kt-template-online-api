-- 增量初始化系统事件站内信表与菜单权限。
-- 用途：已有库不需要重跑完整 vben-admin-init.sql 时，补齐日志级事件通知能力。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_notice` (
  `id` bigint NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` longtext NOT NULL,
  `summary` text DEFAULT NULL,
  `level` int NOT NULL DEFAULT 1,
  `status` int NOT NULL DEFAULT 1,
  `severity` varchar(16) NOT NULL DEFAULT 'info',
  `source` varchar(64) NOT NULL DEFAULT 'system',
  `event_type` varchar(120) NOT NULL DEFAULT 'system.event',
  `dedupe_key` varchar(255) DEFAULT NULL,
  `occurrence_count` int NOT NULL DEFAULT 1,
  `notify_role_code` varchar(64) NOT NULL DEFAULT 'super',
  `metadata` json DEFAULT NULL,
  `is_top` tinyint(1) NOT NULL DEFAULT 0,
  `notify_users` text DEFAULT NULL,
  `created_by` bigint DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `active_dedupe_key` varchar(255) GENERATED ALWAYS AS (CASE WHEN `is_deleted` = 0 AND `dedupe_key` IS NOT NULL THEN `dedupe_key` ELSE NULL END) VIRTUAL,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `first_seen_at` datetime DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_notice_active_dedupe_key` (`active_dedupe_key`),
  KEY `idx_admin_notice_status` (`status`),
  KEY `idx_admin_notice_severity` (`severity`),
  KEY `idx_admin_notice_source_event` (`source`, `event_type`),
  KEY `idx_admin_notice_dedupe_key` (`dedupe_key`),
  KEY `idx_admin_notice_notify_role` (`notify_role_code`),
  KEY `idx_admin_notice_is_top` (`is_top`),
  KEY `idx_admin_notice_is_deleted` (`is_deleted`),
  KEY `idx_admin_notice_create_time` (`create_time`),
  KEY `idx_admin_notice_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @admin_notice_severity_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'severity'
);
SET @admin_notice_severity_sql := IF(
  @admin_notice_severity_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `severity` varchar(16) NOT NULL DEFAULT ''info'' AFTER `status`',
  'SELECT 1'
);
PREPARE admin_notice_severity_stmt FROM @admin_notice_severity_sql;
EXECUTE admin_notice_severity_stmt;
DEALLOCATE PREPARE admin_notice_severity_stmt;

SET @admin_notice_source_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'source'
);
SET @admin_notice_source_sql := IF(
  @admin_notice_source_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `source` varchar(64) NOT NULL DEFAULT ''system'' AFTER `severity`',
  'SELECT 1'
);
PREPARE admin_notice_source_stmt FROM @admin_notice_source_sql;
EXECUTE admin_notice_source_stmt;
DEALLOCATE PREPARE admin_notice_source_stmt;

SET @admin_notice_event_type_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'event_type'
);
SET @admin_notice_event_type_sql := IF(
  @admin_notice_event_type_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `event_type` varchar(120) NOT NULL DEFAULT ''system.event'' AFTER `source`',
  'SELECT 1'
);
PREPARE admin_notice_event_type_stmt FROM @admin_notice_event_type_sql;
EXECUTE admin_notice_event_type_stmt;
DEALLOCATE PREPARE admin_notice_event_type_stmt;

SET @admin_notice_dedupe_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'dedupe_key'
);
SET @admin_notice_dedupe_key_sql := IF(
  @admin_notice_dedupe_key_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `dedupe_key` varchar(255) DEFAULT NULL AFTER `event_type`',
  'SELECT 1'
);
PREPARE admin_notice_dedupe_key_stmt FROM @admin_notice_dedupe_key_sql;
EXECUTE admin_notice_dedupe_key_stmt;
DEALLOCATE PREPARE admin_notice_dedupe_key_stmt;

SET @admin_notice_active_dedupe_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'active_dedupe_key'
);
SET @admin_notice_active_dedupe_key_sql := IF(
  @admin_notice_active_dedupe_key_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `active_dedupe_key` varchar(255) GENERATED ALWAYS AS (CASE WHEN `is_deleted` = 0 AND `dedupe_key` IS NOT NULL THEN `dedupe_key` ELSE NULL END) VIRTUAL AFTER `dedupe_key`',
  'SELECT 1'
);
PREPARE admin_notice_active_dedupe_key_stmt FROM @admin_notice_active_dedupe_key_sql;
EXECUTE admin_notice_active_dedupe_key_stmt;
DEALLOCATE PREPARE admin_notice_active_dedupe_key_stmt;

SET @admin_notice_occurrence_count_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'occurrence_count'
);
SET @admin_notice_occurrence_count_sql := IF(
  @admin_notice_occurrence_count_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `occurrence_count` int NOT NULL DEFAULT 1 AFTER `dedupe_key`',
  'SELECT 1'
);
PREPARE admin_notice_occurrence_count_stmt FROM @admin_notice_occurrence_count_sql;
EXECUTE admin_notice_occurrence_count_stmt;
DEALLOCATE PREPARE admin_notice_occurrence_count_stmt;

SET @admin_notice_notify_role_code_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'notify_role_code'
);
SET @admin_notice_notify_role_code_sql := IF(
  @admin_notice_notify_role_code_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `notify_role_code` varchar(64) NOT NULL DEFAULT ''super'' AFTER `occurrence_count`',
  'SELECT 1'
);
PREPARE admin_notice_notify_role_code_stmt FROM @admin_notice_notify_role_code_sql;
EXECUTE admin_notice_notify_role_code_stmt;
DEALLOCATE PREPARE admin_notice_notify_role_code_stmt;

SET @admin_notice_metadata_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'metadata'
);
SET @admin_notice_metadata_sql := IF(
  @admin_notice_metadata_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `metadata` json DEFAULT NULL AFTER `notify_role_code`',
  'SELECT 1'
);
PREPARE admin_notice_metadata_stmt FROM @admin_notice_metadata_sql;
EXECUTE admin_notice_metadata_stmt;
DEALLOCATE PREPARE admin_notice_metadata_stmt;

SET @admin_notice_first_seen_at_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'first_seen_at'
);
SET @admin_notice_first_seen_at_sql := IF(
  @admin_notice_first_seen_at_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `first_seen_at` datetime DEFAULT NULL AFTER `update_time`',
  'SELECT 1'
);
PREPARE admin_notice_first_seen_at_stmt FROM @admin_notice_first_seen_at_sql;
EXECUTE admin_notice_first_seen_at_stmt;
DEALLOCATE PREPARE admin_notice_first_seen_at_stmt;

SET @admin_notice_last_seen_at_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND COLUMN_NAME = 'last_seen_at'
);
SET @admin_notice_last_seen_at_sql := IF(
  @admin_notice_last_seen_at_exists = 0,
  'ALTER TABLE `admin_notice` ADD COLUMN `last_seen_at` datetime DEFAULT NULL AFTER `first_seen_at`',
  'SELECT 1'
);
PREPARE admin_notice_last_seen_at_stmt FROM @admin_notice_last_seen_at_sql;
EXECUTE admin_notice_last_seen_at_stmt;
DEALLOCATE PREPARE admin_notice_last_seen_at_stmt;

SET @admin_notice_uk_active_dedupe_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'uk_admin_notice_active_dedupe_key'
);
SET @admin_notice_uk_active_dedupe_key_sql := IF(
  @admin_notice_uk_active_dedupe_key_exists = 0,
  'ALTER TABLE `admin_notice` ADD UNIQUE KEY `uk_admin_notice_active_dedupe_key` (`active_dedupe_key`)',
  'SELECT 1'
);
PREPARE admin_notice_uk_active_dedupe_key_stmt FROM @admin_notice_uk_active_dedupe_key_sql;
EXECUTE admin_notice_uk_active_dedupe_key_stmt;
DEALLOCATE PREPARE admin_notice_uk_active_dedupe_key_stmt;

SET @admin_notice_idx_severity_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'idx_admin_notice_severity'
);
SET @admin_notice_idx_severity_sql := IF(
  @admin_notice_idx_severity_exists = 0,
  'ALTER TABLE `admin_notice` ADD INDEX `idx_admin_notice_severity` (`severity`)',
  'SELECT 1'
);
PREPARE admin_notice_idx_severity_stmt FROM @admin_notice_idx_severity_sql;
EXECUTE admin_notice_idx_severity_stmt;
DEALLOCATE PREPARE admin_notice_idx_severity_stmt;

SET @admin_notice_idx_source_event_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'idx_admin_notice_source_event'
);
SET @admin_notice_idx_source_event_sql := IF(
  @admin_notice_idx_source_event_exists = 0,
  'ALTER TABLE `admin_notice` ADD INDEX `idx_admin_notice_source_event` (`source`, `event_type`)',
  'SELECT 1'
);
PREPARE admin_notice_idx_source_event_stmt FROM @admin_notice_idx_source_event_sql;
EXECUTE admin_notice_idx_source_event_stmt;
DEALLOCATE PREPARE admin_notice_idx_source_event_stmt;

SET @admin_notice_idx_dedupe_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'idx_admin_notice_dedupe_key'
);
SET @admin_notice_idx_dedupe_key_sql := IF(
  @admin_notice_idx_dedupe_key_exists = 0,
  'ALTER TABLE `admin_notice` ADD INDEX `idx_admin_notice_dedupe_key` (`dedupe_key`)',
  'SELECT 1'
);
PREPARE admin_notice_idx_dedupe_key_stmt FROM @admin_notice_idx_dedupe_key_sql;
EXECUTE admin_notice_idx_dedupe_key_stmt;
DEALLOCATE PREPARE admin_notice_idx_dedupe_key_stmt;

SET @admin_notice_idx_notify_role_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'idx_admin_notice_notify_role'
);
SET @admin_notice_idx_notify_role_sql := IF(
  @admin_notice_idx_notify_role_exists = 0,
  'ALTER TABLE `admin_notice` ADD INDEX `idx_admin_notice_notify_role` (`notify_role_code`)',
  'SELECT 1'
);
PREPARE admin_notice_idx_notify_role_stmt FROM @admin_notice_idx_notify_role_sql;
EXECUTE admin_notice_idx_notify_role_stmt;
DEALLOCATE PREPARE admin_notice_idx_notify_role_stmt;

SET @admin_notice_idx_last_seen_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_notice'
    AND INDEX_NAME = 'idx_admin_notice_last_seen'
);
SET @admin_notice_idx_last_seen_sql := IF(
  @admin_notice_idx_last_seen_exists = 0,
  'ALTER TABLE `admin_notice` ADD INDEX `idx_admin_notice_last_seen` (`last_seen_at`)',
  'SELECT 1'
);
PREPARE admin_notice_idx_last_seen_stmt FROM @admin_notice_idx_last_seen_sql;
EXECUTE admin_notice_idx_last_seen_stmt;
DEALLOCATE PREPARE admin_notice_idx_last_seen_stmt;

INSERT INTO `admin_menu` (
  `id`,
  `pid`,
  `name`,
  `path`,
  `component`,
  `redirect`,
  `auth_code`,
  `type`,
  `meta`,
  `status`,
  `sort`
)
VALUES (
  2041700000000100206,
  2041700000000100002,
  'SystemNotice',
  '/system/notice',
  '/system/notice/list',
  NULL,
  'System:Notice:List',
  'menu',
  '{"icon":"mdi:bell-outline","title":"system.notice.title"}',
  1,
  7
)
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

DELETE role_menu
FROM `admin_role_menu` role_menu
JOIN `admin_menu` menu ON menu.`id` = role_menu.`menu_id`
WHERE menu.`name` IN ('SystemNoticeCreate');

DELETE FROM `admin_menu`
WHERE `name` IN ('SystemNoticeCreate');

INSERT INTO `admin_menu` (
  `id`,
  `pid`,
  `name`,
  `path`,
  `component`,
  `redirect`,
  `auth_code`,
  `type`,
  `meta`,
  `status`,
  `sort`
)
VALUES
  (2041700000000120212, 2041700000000100206, 'SystemNoticeEdit', NULL, NULL, NULL, 'System:Notice:Edit', 'button', '{"title":"system.notice.markHandled"}', 1, 1),
  (2041700000000120213, 2041700000000100206, 'SystemNoticeDelete', NULL, NULL, NULL, 'System:Notice:Delete', 'button', '{"title":"common.delete"}', 1, 2)
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

DELETE role_menu
FROM `admin_role_menu` role_menu
JOIN `admin_role` role ON role.`id` = role_menu.`role_id`
JOIN `admin_menu` menu ON menu.`id` = role_menu.`menu_id`
WHERE role.`role_code` <> 'super'
  AND menu.`name` IN ('SystemNotice', 'SystemNoticeEdit', 'SystemNoticeDelete');

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN ('SystemNotice', 'SystemNoticeEdit', 'SystemNoticeDelete')
WHERE role.`role_code` = 'super'
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
