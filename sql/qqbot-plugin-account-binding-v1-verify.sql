-- 结果均应为 0；最后两项只用于观察官方账号覆盖量。

SELECT COUNT(*) AS `missing_event_plugin_binding_count`
FROM `qqbot_account_ability` AS `ability`
INNER JOIN `qqbot_account` AS `account`
  ON `account`.`id` = `ability`.`account_id`
INNER JOIN `qqbot_plugin` AS `plugin`
  ON `plugin`.`plugin_key` = `ability`.`ability_key`
LEFT JOIN `qqbot_plugin_account_binding` AS `binding`
  ON `binding`.`plugin_id` = `plugin`.`id`
  AND `binding`.`account_id` = `ability`.`account_id`
  AND `binding`.`enabled` = 1
WHERE `ability`.`ability_type` = 'event_plugin'
  AND `ability`.`is_deleted` = 0
  AND `account`.`is_deleted` = 0
  AND `plugin`.`status` <> 'uninstalled'
  AND `binding`.`id` IS NULL;

SELECT COUNT(*) AS `missing_command_plugin_binding_count`
FROM `qqbot_account_ability` AS `ability`
INNER JOIN `qqbot_account` AS `account`
  ON `account`.`id` = `ability`.`account_id`
INNER JOIN `qqbot_command` AS `command`
  ON `command`.`id` = `ability`.`ability_key`
INNER JOIN `qqbot_plugin` AS `plugin`
  ON `plugin`.`plugin_key` = `command`.`plugin_key`
LEFT JOIN `qqbot_plugin_account_binding` AS `binding`
  ON `binding`.`plugin_id` = `plugin`.`id`
  AND `binding`.`account_id` = `ability`.`account_id`
  AND `binding`.`enabled` = 1
WHERE `ability`.`ability_type` = 'command'
  AND `ability`.`is_deleted` = 0
  AND `account`.`is_deleted` = 0
  AND `command`.`is_deleted` = 0
  AND `plugin`.`status` <> 'uninstalled'
  AND `binding`.`id` IS NULL;

SELECT COUNT(*) AS `orphan_plugin_account_binding_count`
FROM `qqbot_plugin_account_binding` AS `binding`
LEFT JOIN `qqbot_account` AS `account`
  ON `account`.`id` = `binding`.`account_id`
LEFT JOIN `qqbot_plugin` AS `plugin`
  ON `plugin`.`id` = `binding`.`plugin_id`
WHERE `account`.`id` IS NULL OR `plugin`.`id` IS NULL;

SELECT COUNT(*) AS `official_account_count`
FROM `qqbot_account`
WHERE `is_deleted` = 0
  AND `connection_mode` IN ('official-websocket', 'official-webhook');

SELECT COUNT(*) AS `official_plugin_account_binding_count`
FROM `qqbot_plugin_account_binding` AS `binding`
INNER JOIN `qqbot_account` AS `account`
  ON `account`.`id` = `binding`.`account_id`
WHERE `binding`.`enabled` = 1
  AND `account`.`is_deleted` = 0
  AND `account`.`connection_mode` IN (
    'official-websocket',
    'official-webhook'
  );
