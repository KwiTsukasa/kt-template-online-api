-- QQ 官方 Bot WebSocket/Webhook 双 transport 增量结构。
-- 本脚本仅新增 nullable 凭据字段与唯一索引，不修改既有 NapCat 账号。

SET NAMES utf8mb4;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_account` ADD COLUMN `official_app_id` varchar(64) DEFAULT NULL AFTER `self_id`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'official_app_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_account` ADD COLUMN `official_app_secret_ciphertext` varchar(1024) DEFAULT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND column_name = 'official_app_secret_ciphertext'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;

SET @qqbot_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `qqbot_account` ADD UNIQUE KEY `uk_qqbot_account_official_app_id` (`official_app_id`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'qqbot_account'
    AND index_name = 'uk_qqbot_account_official_app_id'
);
PREPARE qqbot_stmt FROM @qqbot_sql;
EXECUTE qqbot_stmt;
DEALLOCATE PREPARE qqbot_stmt;
