-- 所有 *_count / *_mismatch 查询都应返回 0；canonical_table_count 应返回 33。

SELECT COUNT(*) AS `tencent_binding_missing_account_count`
FROM `tencent_bot_plugin_binding` AS `binding`
LEFT JOIN `bot_account` AS `account`
  ON `account`.`id` = `binding`.`account_id`
WHERE `account`.`id` IS NULL
   OR `account`.`connection_mode` NOT IN (
     'official-websocket',
     'official-webhook'
   );

SELECT COUNT(*) AS `tencent_binding_missing_plugin_count`
FROM `tencent_bot_plugin_binding` AS `binding`
LEFT JOIN `plugin` AS `plugin`
  ON `plugin`.`plugin_key` = `binding`.`plugin_key`
WHERE `plugin`.`id` IS NULL;

SELECT COUNT(*) AS `legacy_table_count`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN (
    'qqbot_account',
    'qqbot_account_ability',
    'qqbot_connection_session',
    'qqbot_capability_binding',
    'qqbot_permission_policy',
    'qqbot_allowlist',
    'qqbot_blocklist',
    'qqbot_command',
    'qqbot_command_alias',
    'qqbot_command_log',
    'qqbot_config',
    'qqbot_conversation',
    'qqbot_dedupe',
    'qqbot_dedupe_event',
    'qqbot_message',
    'qqbot_rule',
    'qqbot_send_log',
    'qqbot_send_task',
    'qqbot_message_delivery',
    'qqbot_message_publish_binding',
    'qqbot_message_publish_target',
    'qqbot_message_event',
    'qqbot_message_subscription',
    'qqbot_message_template',
    'qqbot_napcat_webui_gateway_audit',
    'qqbot_plugin',
    'qqbot_plugin_version',
    'qqbot_plugin_installation',
    'qqbot_plugin_operation',
    'qqbot_plugin_event_handler',
    'qqbot_plugin_account_binding',
    'qqbot_plugin_config',
    'qqbot_plugin_asset',
    'qqbot_plugin_runtime_event',
    'qqbot_plugin_task',
    'qqbot_plugin_task_run'
  );

SELECT COUNT(*) AS `canonical_table_count`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN (
    'bot_account',
    'bot_account_ability',
    'bot_connection_session',
    'bot_capability_binding',
    'bot_permission_policy',
    'bot_allowlist',
    'bot_blocklist',
    'bot_command',
    'bot_command_alias',
    'bot_command_log',
    'bot_config',
    'bot_conversation',
    'bot_dedupe',
    'bot_dedupe_event',
    'bot_message',
    'bot_rule',
    'bot_send_log',
    'bot_send_task',
    'bot_message_delivery',
    'bot_message_publish_binding',
    'bot_message_publish_target',
    'napcat_webui_gateway_audit',
    'plugin',
    'plugin_version',
    'plugin_installation',
    'plugin_operation',
    'plugin_event_handler',
    'plugin_config',
    'plugin_asset',
    'plugin_runtime_event',
    'plugin_task',
    'plugin_task_run',
    'tencent_bot_plugin_binding'
  );

SELECT COUNT(DISTINCT `index_name`) AS `legacy_index_name_count`
FROM `information_schema`.`statistics`
WHERE `table_schema` = DATABASE()
  AND `index_name` LIKE '%qqbot%';

WITH `expected_menu` AS (
  SELECT 2041700000000100400 AS `id`, 0 AS `pid`, 'Bot' AS `name`, '/bot' AS `path`, NULL AS `component`, '/bot/dashboard' AS `redirect`, NULL AS `auth_code`
  UNION ALL SELECT 2041700000000100402, 2041700000000100400, 'BotNapcatConnection', '/bot/napcat', '/bot/account/list', NULL, 'Bot:Account:List'
  UNION ALL SELECT 2041700000000100421, 2041700000000100400, 'BotTencentConnection', '/bot/tencent', '/bot/tencent/list', NULL, 'Bot:Tencent:List'
  UNION ALL SELECT 2041700000000100422, 0, 'PluginPlatform', '/plugin-platform', NULL, '/plugin-platform/plugins', NULL
  UNION ALL SELECT 2041700000000100409, 2041700000000100422, 'PluginPlatformPlugins', '/plugin-platform/plugins', '/plugin-platform/plugin/list', NULL, 'PluginPlatform:Plugin:List'
  UNION ALL SELECT 2041700000000100411, 2041700000000100422, 'PluginPlatformTasks', '/plugin-platform/tasks', '/plugin-platform/task/list', NULL, 'PluginPlatform:Task:List'
  UNION ALL SELECT 2041700000000120531, 2041700000000100421, 'BotTencentCreate', NULL, NULL, NULL, 'Bot:Tencent:Create'
  UNION ALL SELECT 2041700000000120532, 2041700000000100421, 'BotTencentEdit', NULL, NULL, NULL, 'Bot:Tencent:Edit'
  UNION ALL SELECT 2041700000000120533, 2041700000000100421, 'BotTencentDelete', NULL, NULL, NULL, 'Bot:Tencent:Delete'
  UNION ALL SELECT 2041700000000120534, 2041700000000100421, 'BotTencentReconnect', NULL, NULL, NULL, 'Bot:Tencent:Reconnect'
  UNION ALL SELECT 2041700000000120535, 2041700000000100421, 'BotTencentPlugin', NULL, NULL, NULL, 'Bot:Tencent:Plugin'
  UNION ALL SELECT 2041700000000120536, 2041700000000100421, 'BotTencentMenuSync', NULL, NULL, NULL, 'Bot:Tencent:MenuSync'
  UNION ALL SELECT 2041700000000120537, 2041700000000100421, 'BotTencentWebhookUrl', NULL, NULL, NULL, 'Bot:Tencent:WebhookUrl'
  UNION ALL SELECT 2041700000000120521, 2041700000000100409, 'PluginPlatformPluginInstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Install'
  UNION ALL SELECT 2041700000000120522, 2041700000000100409, 'PluginPlatformPluginEnable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Enable'
  UNION ALL SELECT 2041700000000120523, 2041700000000100409, 'PluginPlatformPluginDisable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Disable'
  UNION ALL SELECT 2041700000000120524, 2041700000000100409, 'PluginPlatformPluginUpgrade', NULL, NULL, NULL, 'PluginPlatform:Plugin:Upgrade'
  UNION ALL SELECT 2041700000000120525, 2041700000000100409, 'PluginPlatformPluginUninstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Uninstall'
  UNION ALL SELECT 2041700000000120526, 2041700000000100409, 'PluginPlatformPluginConfig', NULL, NULL, NULL, 'PluginPlatform:Plugin:Config'
)
SELECT COUNT(*) AS `canonical_menu_mismatch`
FROM `expected_menu` AS `expected`
LEFT JOIN `admin_menu` AS `actual`
  ON `actual`.`id` = `expected`.`id`
WHERE `actual`.`id` IS NULL
   OR NOT (BINARY `actual`.`name` <=> BINARY `expected`.`name`)
   OR NOT (BINARY `actual`.`path` <=> BINARY `expected`.`path`)
   OR NOT (BINARY `actual`.`component` <=> BINARY `expected`.`component`)
   OR NOT (BINARY `actual`.`redirect` <=> BINARY `expected`.`redirect`)
   OR NOT (BINARY `actual`.`auth_code` <=> BINARY `expected`.`auth_code`)
   OR `actual`.`pid` <> `expected`.`pid`
   OR `actual`.`status` <> 1
   OR `actual`.`is_deleted` <> 0;

WITH `expected_permission` AS (
  SELECT 2041700000000120531 AS `id`
  UNION ALL SELECT 2041700000000120532
  UNION ALL SELECT 2041700000000120533
  UNION ALL SELECT 2041700000000120534
  UNION ALL SELECT 2041700000000120535
  UNION ALL SELECT 2041700000000120536
  UNION ALL SELECT 2041700000000120537
  UNION ALL SELECT 2041700000000120521
  UNION ALL SELECT 2041700000000120522
  UNION ALL SELECT 2041700000000120523
  UNION ALL SELECT 2041700000000120524
  UNION ALL SELECT 2041700000000120525
  UNION ALL SELECT 2041700000000120526
)
SELECT COUNT(*) AS `canonical_menu_role_mismatch`
FROM `admin_role` AS `role`
CROSS JOIN `expected_permission` AS `expected`
LEFT JOIN `admin_role_menu` AS `role_menu`
  ON `role_menu`.`role_id` = `role`.`id`
  AND `role_menu`.`menu_id` = `expected`.`id`
WHERE `role`.`role_code` IN ('super', 'admin')
  AND `role`.`status` = 1
  AND `role`.`is_deleted` = 0
  AND `role_menu`.`menu_id` IS NULL;

SELECT COUNT(*) AS `legacy_menu_contract_count`
FROM `admin_menu`
WHERE `name` LIKE 'QqBot%'
   OR `path` = '/qqbot'
   OR `path` LIKE '/qqbot/%'
   OR `component` LIKE '/qqbot/%'
   OR `auth_code` LIKE 'QqBot:%'
   OR `auth_code` LIKE 'Bot:PluginTask:%'
   OR `path` IN (
     '/bot/plugin',
     '/bot/plugin-task'
   )
   OR `path` LIKE '/bot/plugin-platform/%';

SELECT COUNT(*) AS `plugin_trigger_mode_mismatch`
FROM `admin_dict`
WHERE `dict_code` = 'PLUGIN_TRIGGER_MODE'
  AND `value` IN ('command', 'event')
  AND (`status` <> 1 OR `is_deleted` <> 0);

SELECT 2 - COUNT(*) AS `plugin_trigger_mode_missing_count`
FROM `admin_dict`
WHERE `dict_code` = 'PLUGIN_TRIGGER_MODE'
  AND `value` IN ('command', 'event')
  AND `status` = 1
  AND `is_deleted` = 0;

SELECT COUNT(*) AS `legacy_plugin_trigger_mode_count`
FROM `admin_dict`
WHERE `dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

SELECT COUNT(*) AS `legacy_bot_subscription_key_count`
FROM `message_subscription`
WHERE `subscriber_key` = 'qqbot'
   OR `active_key` LIKE 'qqbot:%';

SELECT COUNT(*) AS `legacy_napcat_reverse_ws_path_count`
FROM `napcat_container`
WHERE `reverse_ws_url` LIKE '%/qqbot/onebot/reverse%';
