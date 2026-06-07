-- 为现有 Admin 用户表补充头像字段。
-- 只补列，不回写数据，避免覆盖用户已上传头像。

SET @admin_user_avatar_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_user'
    AND COLUMN_NAME = 'avatar'
);

SET @admin_user_avatar_sql := IF(
  @admin_user_avatar_exists = 0,
  'ALTER TABLE `admin_user` ADD COLUMN `avatar` varchar(1024) NOT NULL DEFAULT '''' AFTER `real_name`',
  'SELECT 1'
);

PREPARE admin_user_avatar_stmt FROM @admin_user_avatar_sql;
EXECUTE admin_user_avatar_stmt;
DEALLOCATE PREPARE admin_user_avatar_stmt;
