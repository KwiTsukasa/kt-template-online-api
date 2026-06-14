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
  (
    2041700000000100402,
    2041700000000100400,
    'QqBotAccount',
    '/qqbot/account',
    '/qqbot/account/list',
    NULL,
    'QqBot:Account:List',
    'menu',
    '{"icon":"lucide:radio-receiver","title":"账号连接"}',
    1,
    1
  ),
  (
    2041700000000100408,
    2041700000000100400,
    'QqBotCommand',
    '/qqbot/command',
    '/qqbot/command/list',
    NULL,
    'QqBot:Command:List',
    'menu',
    '{"icon":"lucide:square-terminal","title":"在线命令"}',
    1,
    3
  ),
  (
    2041700000000100409,
    2041700000000100400,
    'QqBotPlugin',
    '/qqbot/plugin',
    '/qqbot/plugin/list',
    NULL,
    'QqBot:Plugin:List',
    'menu',
    '{"icon":"lucide:plug","title":"插件能力"}',
    1,
    4
  )
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
  )
ON DUPLICATE KEY UPDATE
  plugin_name = VALUES(plugin_name),
  description = VALUES(description),
  status = VALUES(status);

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
) VALUES (
  1000000000000000201,
  'bangdream.song.search',
  'bangdream_song',
  'bd',
  'BangDream 查歌',
  '["查曲","bd","bangdream","bandori","邦邦","邦邦查歌"]',
  'bangdream',
  1,
  2
) ON DUPLICATE KEY UPDATE
  operation_key = VALUES(operation_key),
  code = VALUES(code),
  name = VALUES(name),
  aliases = VALUES(aliases),
  plugin_key = VALUES(plugin_key),
  enabled = VALUES(enabled),
  cooldown_seconds = VALUES(cooldown_seconds);
