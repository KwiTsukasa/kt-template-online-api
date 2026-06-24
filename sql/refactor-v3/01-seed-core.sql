INSERT INTO admin_role (
  id,
  role_code,
  name,
  remark,
  status
) VALUES (
  2041700000000010001,
  'super',
  '超级管理员',
  '拥有所有后台权限',
  1
) ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  remark = VALUES(remark),
  status = VALUES(status),
  is_deleted = 0;

INSERT INTO admin_dept (
  id,
  pid,
  name,
  status,
  remark
) VALUES (
  2041700000000200001,
  0,
  'KT 总部',
  1,
  '根部门'
) ON DUPLICATE KEY UPDATE
  pid = VALUES(pid),
  name = VALUES(name),
  status = VALUES(status),
  remark = VALUES(remark),
  is_deleted = 0;

INSERT INTO admin_user (
  id,
  username,
  password,
  real_name,
  avatar,
  dept_id,
  home_path,
  timezone,
  status
) VALUES (
  2041700000000000002,
  'admin',
  '123456',
  'Admin',
  '',
  2041700000000200001,
  '/workspace',
  'Asia/Shanghai',
  1
) ON DUPLICATE KEY UPDATE
  password = VALUES(password),
  real_name = VALUES(real_name),
  avatar = VALUES(avatar),
  dept_id = VALUES(dept_id),
  home_path = VALUES(home_path),
  timezone = VALUES(timezone),
  status = VALUES(status),
  is_deleted = 0;

INSERT INTO admin_menu (
  id,
  pid,
  name,
  path,
  component,
  redirect,
  auth_code,
  type,
  meta,
  status,
  sort
) VALUES
  (
    2041700000000100001,
    0,
    'Dashboard',
    '/dashboard',
    NULL,
    '/workspace',
    NULL,
    'catalog',
    '{"order":-1,"title":"page.dashboard.title"}',
    1,
    0
  ),
  (
    2041700000000100102,
    2041700000000100001,
    'Workspace',
    '/workspace',
    '/dashboard/workspace/index',
    NULL,
    NULL,
    'menu',
    '{"icon":"carbon:workspace","title":"page.dashboard.workspace"}',
    1,
    0
  ),
  (
    2041700000000100400,
    0,
    'QqBot',
    '/qqbot',
    NULL,
    '/qqbot/dashboard',
    NULL,
    'catalog',
    '{"icon":"lucide:bot","order":110,"title":"QQBot 管理"}',
    1,
    110
  ),
  (2041700000000100401, 2041700000000100400, 'QqBotDashboard', '/qqbot/dashboard', '/qqbot/dashboard/list', NULL, 'QqBot:Dashboard:List', 'menu', '{"icon":"lucide:gauge","title":"工作台"}', 1, 0),
  (2041700000000100402, 2041700000000100400, 'QqBotAccount', '/qqbot/account', '/qqbot/account/list', NULL, 'QqBot:Account:List', 'menu', '{"icon":"lucide:radio-receiver","title":"账号连接"}', 1, 1),
  (2041700000000100410, 2041700000000100400, 'QqBotAccountConfig', '/qqbot/account/config', '/qqbot/account/config', NULL, 'QqBot:Account:Config', 'menu', '{"activePath":"/qqbot/account","hideInMenu":true,"title":"账号功能配置"}', 1, 0),
  (2041700000000100412, 2041700000000100400, 'QqBotAccountNapcatWebui', '/qqbot/account/:accountId/napcat-webui', '/qqbot/account/napcat-webui/index', NULL, 'QqBot:Account:WebUI', 'menu', '{"activePath":"/qqbot/account","hideInMenu":true,"title":"NapCat WebUI"}', 1, 0),
  (2041700000000120401, 2041700000000100402, 'QqBotAccountCreate', NULL, NULL, NULL, 'QqBot:Account:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120402, 2041700000000100402, 'QqBotAccountEdit', NULL, NULL, NULL, 'QqBot:Account:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120403, 2041700000000100402, 'QqBotAccountDelete', NULL, NULL, NULL, 'QqBot:Account:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120404, 2041700000000100402, 'QqBotAccountKick', NULL, NULL, NULL, 'QqBot:Account:Kick', 'button', '{"title":"断开连接"}', 1, 0),
  (2041700000000120405, 2041700000000100402, 'QqBotAccountRefreshLogin', NULL, NULL, NULL, 'QqBot:Account:RefreshLogin', 'button', '{"title":"更新登录"}', 1, 0),
  (2041700000000120406, 2041700000000100402, 'QqBotAccountConfigButton', NULL, NULL, NULL, 'QqBot:Account:Config', 'button', '{"title":"配置"}', 1, 0),
  (2041700000000120407, 2041700000000100402, 'QqBotAccountWebUI', NULL, NULL, NULL, 'QqBot:Account:WebUI', 'button', '{"title":"NapCat WebUI"}', 1, 0),
  (2041700000000100403, 2041700000000100400, 'QqBotRule', '/qqbot/rule', '/qqbot/rule/list', NULL, 'QqBot:Rule:List', 'menu', '{"icon":"lucide:workflow","title":"自动回复规则"}', 1, 2),
  (2041700000000120411, 2041700000000100403, 'QqBotRuleCreate', NULL, NULL, NULL, 'QqBot:Rule:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120412, 2041700000000100403, 'QqBotRuleEdit', NULL, NULL, NULL, 'QqBot:Rule:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120413, 2041700000000100403, 'QqBotRuleDelete', NULL, NULL, NULL, 'QqBot:Rule:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120414, 2041700000000100403, 'QqBotRuleToggle', NULL, NULL, NULL, 'QqBot:Rule:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000100408, 2041700000000100400, 'QqBotCommand', '/qqbot/command', '/qqbot/command/list', NULL, 'QqBot:Command:List', 'menu', '{"icon":"lucide:square-terminal","title":"在线命令"}', 1, 3),
  (2041700000000120441, 2041700000000100408, 'QqBotCommandCreate', NULL, NULL, NULL, 'QqBot:Command:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120442, 2041700000000100408, 'QqBotCommandEdit', NULL, NULL, NULL, 'QqBot:Command:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120443, 2041700000000100408, 'QqBotCommandDelete', NULL, NULL, NULL, 'QqBot:Command:Delete', 'button', '{"title":"common.delete"}', 1, 0),
  (2041700000000120444, 2041700000000100408, 'QqBotCommandToggle', NULL, NULL, NULL, 'QqBot:Command:Toggle', 'button', '{"title":"启停"}', 1, 0),
  (2041700000000120445, 2041700000000100408, 'QqBotCommandTest', NULL, NULL, NULL, 'QqBot:Command:Test', 'button', '{"title":"测试命令"}', 1, 0),
  (2041700000000100409, 2041700000000100400, 'QqBotPlugin', '/qqbot/plugin', '/qqbot/plugin/list', NULL, 'QqBot:Plugin:List', 'menu', '{"icon":"lucide:plug","title":"插件能力"}', 1, 4),
  (2041700000000100404, 2041700000000100400, 'QqBotConversation', '/qqbot/conversation', '/qqbot/conversation/list', NULL, 'QqBot:Conversation:List', 'menu', '{"icon":"lucide:messages-square","title":"会话管理"}', 1, 5),
  (2041700000000100405, 2041700000000100400, 'QqBotMessage', '/qqbot/message', '/qqbot/message/list', NULL, 'QqBot:Message:List', 'menu', '{"icon":"lucide:message-square-text","title":"消息日志"}', 1, 6),
  (2041700000000100406, 2041700000000100400, 'QqBotSendLog', '/qqbot/sendLog', '/qqbot/sendLog/list', NULL, 'QqBot:SendLog:List', 'menu', '{"icon":"lucide:send","title":"发送日志"}', 1, 7),
  (2041700000000120421, 2041700000000100406, 'QqBotSendPrivate', NULL, NULL, NULL, 'QqBot:Send:Private', 'button', '{"title":"发送私聊"}', 1, 0),
  (2041700000000120422, 2041700000000100406, 'QqBotSendGroup', NULL, NULL, NULL, 'QqBot:Send:Group', 'button', '{"title":"发送群聊"}', 1, 0),
  (2041700000000100407, 2041700000000100400, 'QqBotPermission', '/qqbot/permission', '/qqbot/permission/list', NULL, 'QqBot:Permission:List', 'menu', '{"icon":"lucide:shield-check","title":"权限名单"}', 1, 8),
  (2041700000000120431, 2041700000000100407, 'QqBotPermissionCreate', NULL, NULL, NULL, 'QqBot:Permission:Create', 'button', '{"title":"common.create"}', 1, 0),
  (2041700000000120432, 2041700000000100407, 'QqBotPermissionEdit', NULL, NULL, NULL, 'QqBot:Permission:Edit', 'button', '{"title":"common.edit"}', 1, 0),
  (2041700000000120433, 2041700000000100407, 'QqBotPermissionDelete', NULL, NULL, NULL, 'QqBot:Permission:Delete', 'button', '{"title":"common.delete"}', 1, 0)
ON DUPLICATE KEY UPDATE
  pid = VALUES(pid),
  path = VALUES(path),
  component = VALUES(component),
  redirect = VALUES(redirect),
  auth_code = VALUES(auth_code),
  type = VALUES(type),
  meta = VALUES(meta),
  status = VALUES(status),
  sort = VALUES(sort),
  is_deleted = 0;

INSERT INTO admin_dict (
  id,
  dict_code,
  label,
  value,
  children_code,
  sort,
  status
) VALUES
  (
    2041700000000300001,
    'COMPONENT_TYPE',
    '图表',
    '1',
    'CHART',
    1,
    1
  ),
  (
    2041700000000300101,
    'CHART',
    '未分类',
    '-1',
    NULL,
    0,
    1
  )
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  children_code = VALUES(children_code),
  sort = VALUES(sort),
  status = VALUES(status),
  is_deleted = 0;

INSERT IGNORE INTO admin_user_role (user_id, role_id)
VALUES (2041700000000000002, 2041700000000010001);

INSERT IGNORE INTO admin_role_menu (role_id, menu_id)
SELECT 2041700000000010001, id
FROM admin_menu
WHERE is_deleted = 0;

INSERT INTO platform_setting (
  id,
  setting_key,
  setting_value,
  value_type
) VALUES (
  1000000000000000005,
  'schema.version',
  'refactor-v3',
  'string'
) ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  value_type = VALUES(value_type);

INSERT INTO qqbot_plugin (
  id,
  plugin_key,
  plugin_name,
  description,
  status
) VALUES
  (
    1000000000000000101,
    'bangdream',
    'BangDream',
    'Built-in BangDream command plugin metadata.',
    'installed'
  ),
  (
    1000000000000000102,
    'ff14-market',
    'FF14 Market',
    'Built-in FF14 market command plugin metadata.',
    'installed'
  ),
  (
    1000000000000000103,
    'fflogs',
    'FFLogs',
    'Built-in FFLogs command plugin metadata.',
    'installed'
  ),
  (
    1000000000000000104,
    'repeater',
    'Repeater',
    'Built-in repeater event plugin metadata.',
    'installed'
  ),
  (
    1000000000000000105,
    'bilibili-card',
    'Bilibili Card',
    'Built-in Bilibili card event plugin metadata.',
    'installed'
  )
ON DUPLICATE KEY UPDATE
  plugin_name = VALUES(plugin_name),
  description = VALUES(description),
  status = VALUES(status);

INSERT INTO qqbot_plugin_version (
  id,
  plugin_id,
  version,
  package_hash,
  manifest_json
) VALUES (
  1000000000000001105,
  1000000000000000105,
  '1.0.0',
  'bilibili-card:1.0.0',
  JSON_OBJECT(
    'pluginKey', 'bilibili-card',
    'name', 'Bilibili Card',
    'version', '1.0.0',
    'minApiSdkVersion', '1.0.0',
    'description', '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。',
    'author', 'KT',
    'entry', 'src/index.ts',
    'permissions', JSON_ARRAY(
      'qqbot.event.receive',
      'qqbot.send',
      'runtime.http',
      'plugin.config.read'
    ),
    'runtime', JSON_OBJECT(
      'workerType', 'thread',
      'timeoutMs', 10000,
      'memoryMb', 128,
      'maxConcurrency', 1,
      'configKeys', JSON_ARRAY(
        'QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS',
        'QQBOT_BILIBILI_CARD_MAX_REDIRECTS',
        'QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS',
        'QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH'
      )
    ),
    'configSchema', JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS', JSON_OBJECT(
          'type', 'number',
          'title', 'HTTP 超时毫秒',
          'default', 6000
        ),
        'QQBOT_BILIBILI_CARD_MAX_REDIRECTS', JSON_OBJECT(
          'type', 'number',
          'title', '短链最大跳转次数',
          'default', 5
        ),
        'QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS', JSON_OBJECT(
          'type', 'number',
          'title', '同视频去重毫秒',
          'default', 600000
        ),
        'QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH', JSON_OBJECT(
          'type', 'number',
          'title', '简介最大长度',
          'default', 80
        )
      )
    ),
    'operations', JSON_ARRAY(),
    'events', JSON_ARRAY(JSON_OBJECT(
      'key', 'bilibili-card.message',
      'eventName', 'message',
      'handlerName', 'handleMessage',
      'name', 'Bilibili 卡片解析',
      'description', '解析 QQ 中的 Bilibili 视频链接卡片并回复视频摘要。'
    )),
    'assets', JSON_ARRAY(),
    'migrations', JSON_ARRAY()
  )
) ON DUPLICATE KEY UPDATE
  package_hash = VALUES(package_hash),
  manifest_json = VALUES(manifest_json);

INSERT INTO qqbot_plugin_installation (
  id,
  plugin_id,
  version_id,
  status,
  runtime_status,
  installed_path
) VALUES (
  1000000000000001205,
  1000000000000000105,
  1000000000000001105,
  'enabled',
  'stopped',
  'src/modules/qqbot/plugins/bilibili-card'
) ON DUPLICATE KEY UPDATE
  version_id = VALUES(version_id),
  status = VALUES(status),
  runtime_status = VALUES(runtime_status),
  installed_path = VALUES(installed_path);

INSERT INTO qqbot_plugin_event_handler (
  id,
  plugin_id,
  event_key,
  handler_name,
  enabled
) VALUES (
  1000000000000001305,
  1000000000000000105,
  'bilibili-card.message',
  'handleMessage',
  1
) ON DUPLICATE KEY UPDATE
  handler_name = VALUES(handler_name),
  enabled = VALUES(enabled);

INSERT INTO qqbot_command (
  id,
  operation_key,
  command_key,
  code,
  name,
  aliases,
  plugin_key,
  enabled,
  cooldown_seconds
) VALUES
  (
    1000000000000000201,
    'bangdream.song.search',
    'bangdream_song',
    'bd',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000202,
    'bangdream.song.chart',
    'bangdream_song_chart',
    'bangdream_song_chart',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000203,
    'bangdream.song.random',
    'bangdream_song_random',
    'bangdream_song_random',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000204,
    'bangdream.song.meta',
    'bangdream_song_meta',
    'bangdream_song_meta',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000205,
    'bangdream.card.search',
    'bangdream_card',
    'bangdream_card',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000206,
    'bangdream.card.illustration',
    'bangdream_card_illustration',
    'bangdream_card_illustration',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000207,
    'bangdream.character.search',
    'bangdream_character',
    'bangdream_character',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000208,
    'bangdream.event.search',
    'bangdream_event',
    'bangdream_event',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000209,
    'bangdream.event.stage',
    'bangdream_event_stage',
    'bangdream_event_stage',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000210,
    'bangdream.player.search',
    'bangdream_player',
    'bangdream_player',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000211,
    'bangdream.gacha.search',
    'bangdream_gacha',
    'bangdream_gacha',
    '',
    '[]',
    'bangdream',
    1,
    2
  ),
  (
    1000000000000000212,
    'bangdream.gacha.simulate',
    'bangdream_gacha_simulate',
    'bangdream_gacha_simulate',
    '',
    '[]',
    'bangdream',
    1,
    3
  ),
  (
    1000000000000000213,
    'bangdream.cutoff.detail',
    'bangdream_cutoff_detail',
    'bangdream_cutoff_detail',
    '',
    '[]',
    'bangdream',
    1,
    3
  ),
  (
    1000000000000000214,
    'bangdream.cutoff.all',
    'bangdream_cutoff_all',
    'bangdream_cutoff_all',
    '',
    '[]',
    'bangdream',
    1,
    3
  ),
  (
    1000000000000000215,
    'bangdream.cutoff.recent',
    'bangdream_cutoff_recent',
    'bangdream_cutoff_recent',
    '',
    '[]',
    'bangdream',
    1,
    3
  )
ON DUPLICATE KEY UPDATE
  operation_key = VALUES(operation_key),
  code = VALUES(code),
  name = VALUES(name),
  aliases = VALUES(aliases),
  plugin_key = VALUES(plugin_key),
  enabled = VALUES(enabled),
  cooldown_seconds = VALUES(cooldown_seconds),
  is_deleted = 0;
