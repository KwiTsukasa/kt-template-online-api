-- 增量补齐个人中心隐藏菜单。
-- 用途：已有库不需要重跑完整 vben-admin-init.sql 时，可单独执行本文件。

SET NAMES utf8mb4;

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
  2041700000000100011,
  0,
  'Profile',
  '/profile',
  '_core/profile/index',
  NULL,
  NULL,
  'menu',
  '{"hideInMenu":true,"icon":"lucide:user","title":"page.auth.profile"}',
  1,
  10000
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

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT role.`id`, menu.`id`
FROM `admin_role` role
JOIN `admin_menu` menu ON menu.`name` = 'Profile'
WHERE role.`is_deleted` = 0
  AND menu.`is_deleted` = 0;
