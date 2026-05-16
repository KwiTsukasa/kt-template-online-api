-- 旧 dict 表到新 admin_dict 表的数据迁移脚本。
-- 使用方式：目标库里仍存在旧 `dict` 表时，在执行 `vben-admin-init.sql` 创建新表后执行本脚本。

SET NAMES utf8mb4;
SET @dict_snowflake_base := 2041700000000400000;
SET @dict_snowflake_row := 0;

INSERT INTO `admin_dict` (
  `id`,
  `dict_code`,
  `label`,
  `value`,
  `children_code`,
  `sort`,
  `status`,
  `is_deleted`,
  `create_time`,
  `update_time`
)
SELECT
  CASE
    WHEN CAST(`id` AS CHAR) REGEXP '^[0-9]+$' THEN CAST(`id` AS UNSIGNED)
    ELSE @dict_snowflake_base + (@dict_snowflake_row := @dict_snowflake_row + 1)
  END,
  `dict_key`,
  `label`,
  `value`,
  `children_key`,
  COALESCE(`sort`, 0),
  IF(COALESCE(`is_deleted`, 0) = 0, 1, 0),
  COALESCE(`is_deleted`, 0),
  COALESCE(`create_time`, CURRENT_TIMESTAMP(6)),
  COALESCE(`update_time`, CURRENT_TIMESTAMP(6))
FROM `dict`
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
  `is_deleted` = VALUES(`is_deleted`),
  `update_time` = VALUES(`update_time`);
