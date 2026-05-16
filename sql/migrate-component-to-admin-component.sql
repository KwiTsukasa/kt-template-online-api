-- 将旧 component 表迁移为 admin_component。
-- 旧表若存在会先复制数据，再重命名为 component_bak_before_admin_prefix_yyyyMMddHHmmss 备份表。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `admin_component` (
  `id` bigint NOT NULL,
  `name` varchar(255) NOT NULL DEFAULT '',
  `type` int NOT NULL,
  `component_type` int NOT NULL,
  `image` mediumtext NOT NULL,
  `template` mediumtext NOT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_admin_component_type` (`type`),
  KEY `idx_admin_component_component_type` (`component_type`),
  KEY `idx_admin_component_deleted` (`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @component_old_exists = (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'component'
);

SET @component_row := 0;
SET @component_copy_sql = IF(
  @component_old_exists = 1,
  'INSERT IGNORE INTO `admin_component` (`id`, `name`, `type`, `component_type`, `image`, `template`, `is_deleted`, `create_time`, `update_time`)
   SELECT
     CASE
       WHEN CAST(`id` AS CHAR) REGEXP ''^[0-9]+$'' AND CAST(`id` AS UNSIGNED) > 0 THEN CAST(`id` AS UNSIGNED)
       ELSE 2041700000000500000 + (@component_row := @component_row + 1)
     END,
     `name`,
     `type`,
     `component_type`,
     `image`,
     `template`,
     `is_deleted`,
     `create_time`,
     `update_time`
   FROM `component`',
  'SELECT 1'
);
PREPARE component_copy_stmt FROM @component_copy_sql;
EXECUTE component_copy_stmt;
DEALLOCATE PREPARE component_copy_stmt;

SET @component_backup_table = CONCAT(
  'component_bak_before_admin_prefix_',
  DATE_FORMAT(NOW(), '%Y%m%d%H%i%s')
);
SET @component_rename_sql = IF(
  @component_old_exists = 1,
  CONCAT('RENAME TABLE `component` TO `', @component_backup_table, '`'),
  'SELECT 1'
);
PREPARE component_rename_stmt FROM @component_rename_sql;
EXECUTE component_rename_stmt;
DEALLOCATE PREPARE component_rename_stmt;

SET FOREIGN_KEY_CHECKS = 1;
