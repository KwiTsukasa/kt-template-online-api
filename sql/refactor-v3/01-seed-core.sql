INSERT INTO admin_user (
  id,
  username,
  password_hash,
  nickname,
  status
) VALUES (
  1000000000000000001,
  'admin',
  '!disabled-refactor-v3-password-hash!',
  'Administrator',
  'password_unset'
) ON DUPLICATE KEY UPDATE
  nickname = VALUES(nickname),
  status = VALUES(status);

INSERT INTO admin_role (
  id,
  role_key,
  role_name,
  status
) VALUES (
  1000000000000000002,
  'super_admin',
  'Super Administrator',
  'enabled'
) ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  status = VALUES(status);

INSERT INTO admin_user_role (
  id,
  user_id,
  role_id
) VALUES (
  1000000000000000003,
  1000000000000000001,
  1000000000000000002
) ON DUPLICATE KEY UPDATE
  role_id = VALUES(role_id);

INSERT INTO admin_menu (
  id,
  parent_id,
  menu_key,
  title,
  path,
  component,
  sort_no,
  status
) VALUES (
  1000000000000000004,
  NULL,
  'dashboard',
  'Dashboard',
  '/dashboard',
  'dashboard/workspace/index',
  10,
  'enabled'
) ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  path = VALUES(path),
  component = VALUES(component),
  status = VALUES(status);

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
  plugin_key,
  enabled,
  cooldown_seconds
) VALUES (
  1000000000000000201,
  'bangdream.song.search',
  'bangdream_song',
  'bangdream',
  1,
  2
) ON DUPLICATE KEY UPDATE
  operation_key = VALUES(operation_key),
  plugin_key = VALUES(plugin_key),
  enabled = VALUES(enabled),
  cooldown_seconds = VALUES(cooldown_seconds);
