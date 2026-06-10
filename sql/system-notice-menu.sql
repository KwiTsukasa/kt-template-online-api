-- 增量初始化系统站内信表与菜单权限。
-- 用途：已有库不需要重跑完整 vben-admin-init.sql 时，补齐站内信能力。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_notice` (
  `id` bigint NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` longtext NOT NULL,
  `summary` text DEFAULT NULL,
  `level` int NOT NULL DEFAULT 1,
  `status` int NOT NULL DEFAULT 1,
  `is_top` tinyint(1) NOT NULL DEFAULT 0,
  `notify_users` text DEFAULT NULL,
  `created_by` bigint DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_admin_notice_status` (`status`),
  KEY `idx_admin_notice_is_top` (`is_top`),
  KEY `idx_admin_notice_is_deleted` (`is_deleted`),
  KEY `idx_admin_notice_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  (2041700000000120211, 2041700000000100206, 'SystemNoticeCreate', NULL, NULL, NULL, 'System:Notice:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120212, 2041700000000100206, 'SystemNoticeEdit', NULL, NULL, NULL, 'System:Notice:Edit', 'button', '{"title":"common.edit"}', 1, 1),
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

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` IN ('SystemNotice', 'SystemNoticeCreate', 'SystemNoticeEdit', 'SystemNoticeDelete')
WHERE role.`role_code` IN ('super', 'admin')
  AND role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
