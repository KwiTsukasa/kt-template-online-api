-- 将线上 QQBot 菜单、权限与插件字典迁为 Bot / Bot Adapter / Plugin Platform 契约。
-- 本脚本仅修改 admin_menu、admin_role_menu 与 PLUGIN_TRIGGER_MODE 字典，可重复执行。

SET NAMES utf8mb4;

START TRANSACTION;

DELETE `legacy`
FROM `admin_dict` AS `legacy`
INNER JOIN `admin_dict` AS `canonical`
  ON `canonical`.`dict_code` = 'PLUGIN_TRIGGER_MODE'
  AND `canonical`.`value` = `legacy`.`value`
WHERE `legacy`.`dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

DELETE `duplicate`
FROM `admin_dict` AS `duplicate`
INNER JOIN `admin_dict` AS `retained`
  ON `retained`.`value` = `duplicate`.`value`
  AND `retained`.`dict_code` IN (
    'QQBOT_PLUGIN_TRIGGER_MODE',
    'BOT_PLUGIN_TRIGGER_MODE'
  )
  AND `retained`.`id` < `duplicate`.`id`
WHERE `duplicate`.`dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

UPDATE `admin_dict`
SET `dict_code` = 'PLUGIN_TRIGGER_MODE'
WHERE `dict_code` IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

INSERT INTO `admin_dict` (
  `id`,
  `dict_code`,
  `label`,
  `value`,
  `children_code`,
  `sort`,
  `status`
)
VALUES
  (2041700000000300401, 'PLUGIN_TRIGGER_MODE', '命令', 'command', NULL, 1, 1),
  (2041700000000300402, 'PLUGIN_TRIGGER_MODE', '事件', 'event', NULL, 2, 1)
ON DUPLICATE KEY UPDATE
  `dict_code` = VALUES(`dict_code`),
  `label` = VALUES(`label`),
  `children_code` = VALUES(`children_code`),
  `sort` = VALUES(`sort`),
  `status` = VALUES(`status`),
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
  (2041700000000100400, 0, 'Bot', '/bot', NULL, '/bot/dashboard', NULL, 'catalog', '{"icon":"lucide:bot","order":110,"title":"Bot 管理"}', 1, 110),
  (2041700000000100401, 2041700000000100400, 'BotDashboard', '/bot/dashboard', '/bot/dashboard/list', NULL, 'Bot:Dashboard:List', 'menu', '{"icon":"lucide:gauge","title":"工作台"}', 1, 0),
  (2041700000000100402, 2041700000000100400, 'BotNapcatConnection', '/bot/napcat', '/bot/account/list', NULL, 'Bot:Account:List', 'menu', '{"icon":"lucide:radio-receiver","title":"NapCat 连接"}', 1, 1),
  (2041700000000100410, 2041700000000100400, 'BotNapcatConfig', '/bot/napcat/config', '/bot/account/config', NULL, 'Bot:Account:Config', 'menu', '{"activePath":"/bot/napcat","hideInMenu":true,"title":"NapCat 功能配置"}', 1, 0),
  (2041700000000100412, 2041700000000100400, 'BotNapcatWebui', '/bot/napcat/:accountId/webui', '/bot/account/napcat-webui/index', NULL, 'Bot:Account:WebUI', 'menu', '{"activePath":"/bot/napcat","hideInMenu":true,"title":"NapCat WebUI"}', 1, 0),
  (2041700000000100421, 2041700000000100400, 'BotTencentConnection', '/bot/tencent', '/bot/tencent/list', NULL, 'Bot:Tencent:List', 'menu', '{"icon":"lucide:cloud-cog","title":"Tencent 连接"}', 1, 2),
  (2041700000000120401, 2041700000000100402, 'BotAccountCreate', NULL, NULL, NULL, 'Bot:Account:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120402, 2041700000000100402, 'BotAccountEdit', NULL, NULL, NULL, 'Bot:Account:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120403, 2041700000000100402, 'BotAccountDelete', NULL, NULL, NULL, 'Bot:Account:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120404, 2041700000000100402, 'BotAccountKick', NULL, NULL, NULL, 'Bot:Account:Kick', 'button', '{"title":"断开连接"}', 1, 0),
  (2041700000000120405, 2041700000000100402, 'BotAccountRefreshLogin', NULL, NULL, NULL, 'Bot:Account:RefreshLogin', 'button', '{"title":"更新登录"}', 1, 0),
  (2041700000000120406, 2041700000000100402, 'BotAccountConfigButton', NULL, NULL, NULL, 'Bot:Account:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000120407, 2041700000000100402, 'BotAccountWebUI', NULL, NULL, NULL, 'Bot:Account:WebUI', 'button', '{"title":"NapCat WebUI"}', 1, 0),
  (2041700000000100403, 2041700000000100400, 'BotRule', '/bot/rule', '/bot/rule/list', NULL, 'Bot:Rule:List', 'menu', '{"icon":"lucide:workflow","title":"自动回复规则"}', 1, 3),
  (2041700000000120411, 2041700000000100403, 'BotRuleCreate', NULL, NULL, NULL, 'Bot:Rule:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120412, 2041700000000100403, 'BotRuleEdit', NULL, NULL, NULL, 'Bot:Rule:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120413, 2041700000000100403, 'BotRuleDelete', NULL, NULL, NULL, 'Bot:Rule:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120414, 2041700000000100403, 'BotRuleToggle', NULL, NULL, NULL, 'Bot:Rule:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000100408, 2041700000000100400, 'BotCommand', '/bot/command', '/bot/command/list', NULL, 'Bot:Command:List', 'menu', '{"icon":"lucide:square-terminal","title":"在线命令"}', 1, 4),
  (2041700000000120441, 2041700000000100408, 'BotCommandCreate', NULL, NULL, NULL, 'Bot:Command:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120442, 2041700000000100408, 'BotCommandEdit', NULL, NULL, NULL, 'Bot:Command:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120443, 2041700000000100408, 'BotCommandDelete', NULL, NULL, NULL, 'Bot:Command:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120444, 2041700000000100408, 'BotCommandToggle', NULL, NULL, NULL, 'Bot:Command:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000120445, 2041700000000100408, 'BotCommandTest', NULL, NULL, NULL, 'Bot:Command:Test', 'button', '{"title":"测试命令"}', 1, 0),
  (2041700000000100404, 2041700000000100400, 'BotConversation', '/bot/conversation', '/bot/conversation/list', NULL, 'Bot:Conversation:List', 'menu', '{"icon":"lucide:messages-square","title":"会话管理"}', 1, 5),
  (2041700000000100405, 2041700000000100400, 'BotMessage', '/bot/message', '/bot/message/list', NULL, 'Bot:Message:List', 'menu', '{"icon":"lucide:message-square-text","title":"消息日志"}', 1, 6),
  (2041700000000100406, 2041700000000100400, 'BotSendLog', '/bot/send-log', '/bot/send-log/list', NULL, 'Bot:SendLog:List', 'menu', '{"icon":"lucide:send","title":"发送日志"}', 1, 7),
  (2041700000000120421, 2041700000000100406, 'BotSendPrivate', NULL, NULL, NULL, 'Bot:Send:Private', 'button', '{"title":"发送私聊"}', 1, 0),
  (2041700000000120422, 2041700000000100406, 'BotSendGroup', NULL, NULL, NULL, 'Bot:Send:Group', 'button', '{"title":"发送群聊"}', 1, 0),
  (2041700000000100407, 2041700000000100400, 'BotPermission', '/bot/permission', '/bot/permission/list', NULL, 'Bot:Permission:List', 'menu', '{"icon":"lucide:shield-check","title":"权限名单"}', 1, 8),
  (2041700000000120431, 2041700000000100407, 'BotPermissionCreate', NULL, NULL, NULL, 'Bot:Permission:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120432, 2041700000000100407, 'BotPermissionEdit', NULL, NULL, NULL, 'Bot:Permission:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120433, 2041700000000100407, 'BotPermissionDelete', NULL, NULL, NULL, 'Bot:Permission:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120531, 2041700000000100421, 'BotTencentCreate', NULL, NULL, NULL, 'Bot:Tencent:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120532, 2041700000000100421, 'BotTencentEdit', NULL, NULL, NULL, 'Bot:Tencent:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120533, 2041700000000100421, 'BotTencentDelete', NULL, NULL, NULL, 'Bot:Tencent:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120534, 2041700000000100421, 'BotTencentReconnect', NULL, NULL, NULL, 'Bot:Tencent:Reconnect', 'button', '{"title":"重连"}', 1, 0),
  (2041700000000120535, 2041700000000100421, 'BotTencentPlugin', NULL, NULL, NULL, 'Bot:Tencent:Plugin', 'button', '{"title":"插件能力"}', 1, 0),
  (2041700000000120536, 2041700000000100421, 'BotTencentMenuSync', NULL, NULL, NULL, 'Bot:Tencent:MenuSync', 'button', '{"title":"同步官方菜单"}', 1, 0),
  (2041700000000120537, 2041700000000100421, 'BotTencentWebhookUrl', NULL, NULL, NULL, 'Bot:Tencent:WebhookUrl', 'button', '{"title":"复制 Webhook 回调"}', 1, 0),
  (2041700000000100422, 0, 'PluginPlatform', '/plugin-platform', NULL, '/plugin-platform/plugins', NULL, 'catalog', '{"icon":"lucide:blocks","order":111,"title":"插件平台"}', 1, 111),
  (2041700000000100409, 2041700000000100422, 'PluginPlatformPlugins', '/plugin-platform/plugins', '/plugin-platform/plugin/list', NULL, 'PluginPlatform:Plugin:List', 'menu', '{"icon":"lucide:plug","title":"插件管理"}', 1, 0),
  (2041700000000120521, 2041700000000100409, 'PluginPlatformPluginInstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Install', 'button', '{"title":"安装"}', 1, 0),
  (2041700000000120522, 2041700000000100409, 'PluginPlatformPluginEnable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Enable', 'button', '{"title":"启用"}', 1, 0),
  (2041700000000120523, 2041700000000100409, 'PluginPlatformPluginDisable', NULL, NULL, NULL, 'PluginPlatform:Plugin:Disable', 'button', '{"title":"停用"}', 1, 0),
  (2041700000000120524, 2041700000000100409, 'PluginPlatformPluginUpgrade', NULL, NULL, NULL, 'PluginPlatform:Plugin:Upgrade', 'button', '{"title":"升级"}', 1, 0),
  (2041700000000120525, 2041700000000100409, 'PluginPlatformPluginUninstall', NULL, NULL, NULL, 'PluginPlatform:Plugin:Uninstall', 'button', '{"title":"卸载"}', 1, 0),
  (2041700000000120526, 2041700000000100409, 'PluginPlatformPluginConfig', NULL, NULL, NULL, 'PluginPlatform:Plugin:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000100411, 2041700000000100422, 'PluginPlatformTasks', '/plugin-platform/tasks', '/plugin-platform/task/list', NULL, 'PluginPlatform:Task:List', 'menu', '{"icon":"lucide:calendar-clock","title":"定时任务"}', 1, 1),
  (2041700000000120451, 2041700000000100411, 'PluginPlatformTaskUpdateCron', NULL, NULL, NULL, 'PluginPlatform:Task:UpdateCron', 'button', '{"title":"修改 Cron"}', 1, 0),
  (2041700000000120452, 2041700000000100411, 'PluginPlatformTaskEnable', NULL, NULL, NULL, 'PluginPlatform:Task:Enable', 'button', '{"title":"启用"}', 1, 0),
  (2041700000000120453, 2041700000000100411, 'PluginPlatformTaskDisable', NULL, NULL, NULL, 'PluginPlatform:Task:Disable', 'button', '{"title":"停用"}', 1, 0),
  (2041700000000120454, 2041700000000100411, 'PluginPlatformTaskRun', NULL, NULL, NULL, 'PluginPlatform:Task:Run', 'button', '{"title":"手动运行"}', 1, 0),
  (2041700000000120455, 2041700000000100411, 'PluginPlatformTaskRunLog', NULL, NULL, NULL, 'PluginPlatform:Task:RunLog', 'button', '{"title":"运行记录"}', 1, 0),
  (2041700000000120481, 2041700000000100410, 'BotAccountMessagePushList', NULL, NULL, NULL, 'Bot:Account:MessagePush:List', 'button', '{"title":"common.list"}', 1, 0),
  (2041700000000120482, 2041700000000100410, 'BotAccountMessagePushCreate', NULL, NULL, NULL, 'Bot:Account:MessagePush:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120483, 2041700000000100410, 'BotAccountMessagePushUpdate', NULL, NULL, NULL, 'Bot:Account:MessagePush:Update', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120484, 2041700000000100410, 'BotAccountMessagePushDelete', NULL, NULL, NULL, 'Bot:Account:MessagePush:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120485, 2041700000000100410, 'BotAccountMessagePushToggle', NULL, NULL, NULL, 'Bot:Account:MessagePush:Toggle', 'button', '{"title":"启停"}', 1, 0)
ON DUPLICATE KEY UPDATE
  `pid` = VALUES(`pid`),
  `name` = VALUES(`name`),
  `path` = VALUES(`path`),
  `component` = VALUES(`component`),
  `redirect` = VALUES(`redirect`),
  `auth_code` = VALUES(`auth_code`),
  `type` = VALUES(`type`),
  `meta` = VALUES(`meta`),
  `status` = VALUES(`status`),
  `sort` = VALUES(`sort`),
  `is_deleted` = 0;

DELETE `role_menu`
FROM `admin_role_menu` AS `role_menu`
INNER JOIN `admin_menu` AS `menu`
  ON `menu`.`id` = `role_menu`.`menu_id`
WHERE `menu`.`name` LIKE 'QqBot%'
   OR `menu`.`path` = '/qqbot'
   OR `menu`.`path` LIKE '/qqbot/%'
   OR `menu`.`component` LIKE '/qqbot/%'
   OR `menu`.`auth_code` LIKE 'QqBot:%'
   OR `menu`.`auth_code` LIKE 'Bot:PluginTask:%'
   OR `menu`.`path` IN ('/bot/plugin', '/bot/plugin-task')
   OR `menu`.`path` LIKE '/bot/plugin-platform/%';

DELETE FROM `admin_menu`
WHERE `name` LIKE 'QqBot%'
   OR `path` = '/qqbot'
   OR `path` LIKE '/qqbot/%'
   OR `component` LIKE '/qqbot/%'
   OR `auth_code` LIKE 'QqBot:%'
   OR `auth_code` LIKE 'Bot:PluginTask:%'
   OR `path` IN ('/bot/plugin', '/bot/plugin-task')
   OR `path` LIKE '/bot/plugin-platform/%';

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT `role`.`id`, `menu`.`id`
FROM `admin_role` AS `role`
JOIN `admin_menu` AS `menu`
  ON `menu`.`name` LIKE 'Bot%'
  OR `menu`.`name` LIKE 'PluginPlatform%'
WHERE `role`.`role_code` IN ('super', 'admin')
  AND `role`.`status` = 1
  AND `role`.`is_deleted` = 0
  AND `menu`.`is_deleted` = 0;

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100400
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000100401,
  2041700000000100402,
  2041700000000100403,
  2041700000000100404,
  2041700000000100405,
  2041700000000100406,
  2041700000000100407,
  2041700000000100408,
  2041700000000100410,
  2041700000000100412,
  2041700000000100421
);

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100410
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000120481,
  2041700000000120482,
  2041700000000120483,
  2041700000000120484,
  2041700000000120485
);

INSERT IGNORE INTO `admin_role_menu` (`role_id`, `menu_id`)
SELECT DISTINCT `role_menu`.`role_id`, 2041700000000100422
FROM `admin_role_menu` AS `role_menu`
WHERE `role_menu`.`menu_id` IN (
  2041700000000100409,
  2041700000000100411,
  2041700000000120521,
  2041700000000120522,
  2041700000000120523,
  2041700000000120524,
  2041700000000120525,
  2041700000000120526,
  2041700000000120451,
  2041700000000120452,
  2041700000000120453,
  2041700000000120454,
  2041700000000120455
);

COMMIT;
