-- 同一群或频道的精确成员保存在一条名单中；仅补齐空集合列，保留旧字段供核对与回滚。
SET NAMES utf8mb4;

DELIMITER $$

DROP PROCEDURE IF EXISTS `kt_migrate_bot_permission_user_sets_v1`$$

CREATE PROCEDURE `kt_migrate_bot_permission_user_sets_v1`(IN permission_table VARCHAR(64))
BEGIN
  DECLARE column_count INT DEFAULT 0;
  DECLARE valid_column_count INT DEFAULT 0;

  IF permission_table NOT IN ('bot_allowlist', 'bot_blocklist') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unexpected permission table';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(data_type = 'json' AND is_nullable = 'YES'), 0)
    INTO column_count, valid_column_count
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = permission_table AND column_name = 'user_ids';

  IF column_count = 0 THEN
    SET @permission_sql = CONCAT('ALTER TABLE `', permission_table,
      '` ADD COLUMN `user_ids` JSON NULL AFTER `user_id`');
    PREPARE permission_stmt FROM @permission_sql;
    EXECUTE permission_stmt;
    DEALLOCATE PREPARE permission_stmt;
  ELSEIF valid_column_count <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permission user_ids must be nullable JSON';
  END IF;

  SET @permission_sql = CONCAT('UPDATE `', permission_table,
    '` SET user_ids = JSON_ARRAY(user_id), update_time = update_time',
    ' WHERE user_ids IS NULL AND precise_user = 1',
    ' AND target_type IN (''group'', ''channel'') AND user_id <> ''''');
  PREPARE permission_stmt FROM @permission_sql;
  EXECUTE permission_stmt;
  DEALLOCATE PREPARE permission_stmt;

  SET @permission_sql = CONCAT('UPDATE `', permission_table,
    '` SET user_ids = JSON_ARRAY(), update_time = update_time WHERE user_ids IS NULL');
  PREPARE permission_stmt FROM @permission_sql;
  EXECUTE permission_stmt;
  DEALLOCATE PREPARE permission_stmt;
END$$

CALL `kt_migrate_bot_permission_user_sets_v1`('bot_allowlist')$$
CALL `kt_migrate_bot_permission_user_sets_v1`('bot_blocklist')$$
DROP PROCEDURE `kt_migrate_bot_permission_user_sets_v1`$$

DELIMITER ;
