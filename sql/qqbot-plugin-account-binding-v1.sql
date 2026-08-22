-- 将既有账号能力绑定迁入 QQBot 插件平台权威绑定表。
-- 仅补缺失行；重复执行不会重新启用管理员已经停用的平台绑定。

START TRANSACTION;

INSERT IGNORE INTO `qqbot_plugin_account_binding` (
  `id`,
  `plugin_id`,
  `account_id`,
  `enabled`,
  `create_time`
)
SELECT
  CAST(
    (
      UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 1288834974657
    ) * 4194304
    + 380000
    + ROW_NUMBER() OVER (
      ORDER BY `candidate`.`plugin_id`, `candidate`.`account_id`
    )
    AS UNSIGNED
  ) AS `id`,
  `candidate`.`plugin_id`,
  `candidate`.`account_id`,
  1 AS `enabled`,
  CURRENT_TIMESTAMP AS `create_time`
FROM (
  SELECT DISTINCT
    `plugin`.`id` AS `plugin_id`,
    `ability`.`account_id` AS `account_id`
  FROM `qqbot_account_ability` AS `ability`
  INNER JOIN `qqbot_account` AS `account`
    ON `account`.`id` = `ability`.`account_id`
  INNER JOIN `qqbot_plugin` AS `plugin`
    ON `plugin`.`plugin_key` = `ability`.`ability_key`
  WHERE `ability`.`ability_type` = 'event_plugin'
    AND `ability`.`is_deleted` = 0
    AND `account`.`is_deleted` = 0
    AND `plugin`.`status` <> 'uninstalled'

  UNION

  SELECT DISTINCT
    `plugin`.`id` AS `plugin_id`,
    `ability`.`account_id` AS `account_id`
  FROM `qqbot_account_ability` AS `ability`
  INNER JOIN `qqbot_account` AS `account`
    ON `account`.`id` = `ability`.`account_id`
  INNER JOIN `qqbot_command` AS `command`
    ON `command`.`id` = `ability`.`ability_key`
  INNER JOIN `qqbot_plugin` AS `plugin`
    ON `plugin`.`plugin_key` = `command`.`plugin_key`
  WHERE `ability`.`ability_type` = 'command'
    AND `ability`.`is_deleted` = 0
    AND `account`.`is_deleted` = 0
    AND `command`.`is_deleted` = 0
    AND `plugin`.`status` <> 'uninstalled'
) AS `candidate`;

COMMIT;
