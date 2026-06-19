SELECT 'admin_user' AS table_name, COUNT(*) AS row_count FROM admin_user;
SELECT 'admin_role' AS table_name, COUNT(*) AS row_count FROM admin_role;
SELECT 'admin_menu' AS table_name, COUNT(*) AS row_count FROM admin_menu;
SELECT 'platform_setting' AS table_name, COUNT(*) AS row_count FROM platform_setting;
SELECT 'admin_dict' AS table_name, COUNT(*) AS row_count FROM admin_dict;
SELECT 'qqbot_command' AS table_name, COUNT(*) AS row_count FROM qqbot_command;
SELECT 'qqbot_plugin' AS table_name, COUNT(*) AS row_count FROM qqbot_plugin;
SELECT 'napcat_container' AS table_name, COUNT(*) AS row_count FROM napcat_container;
SELECT 'napcat_device_identity' AS table_name, COUNT(*) AS row_count FROM napcat_device_identity;
SELECT 'napcat_account_binding' AS table_name, COUNT(*) AS row_count FROM napcat_account_binding;
SELECT 'napcat_login_session' AS table_name, COUNT(*) AS row_count FROM napcat_login_session;
SELECT 'napcat_login_challenge' AS table_name, COUNT(*) AS row_count FROM napcat_login_challenge;
SELECT 'napcat_runtime_cleanup' AS table_name, COUNT(*) AS row_count FROM napcat_runtime_cleanup;
SELECT 'napcat_runtime_profile' AS table_name, COUNT(*) AS row_count FROM napcat_runtime_profile;
SELECT 'napcat_protocol_profile' AS table_name, COUNT(*) AS row_count FROM napcat_protocol_profile;
SELECT 'napcat_session_behavior_profile' AS table_name, COUNT(*) AS row_count FROM napcat_session_behavior_profile;
SELECT 'napcat_login_event' AS table_name, COUNT(*) AS row_count FROM napcat_login_event;
SELECT 'napcat_risk_mode' AS table_name, COUNT(*) AS row_count FROM napcat_risk_mode;
SELECT 'qqbot_plugin_task' AS table_name, COUNT(*) AS row_count FROM qqbot_plugin_task;
SELECT 'qqbot_plugin_task_run' AS table_name, COUNT(*) AS row_count FROM qqbot_plugin_task_run;

SELECT 'seed_admin_user' AS check_name, COUNT(*) AS matched_rows
FROM admin_user
WHERE username = 'admin'
  AND password <> ''
  AND status = 1
  AND is_deleted = 0;

SELECT 'seed_platform_schema_version' AS check_name, COUNT(*) AS matched_rows
FROM platform_setting
WHERE setting_key = 'schema.version'
  AND setting_value = 'refactor-v3';

SELECT 'seed_qqbot_plugin_bangdream' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin
WHERE plugin_key = 'bangdream'
  AND status = 'installed';

SELECT 'seed_qqbot_plugin_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin
WHERE plugin_key = 'bilibili-card'
  AND status = 'installed';

SELECT 'seed_qqbot_plugin_version_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin_version v
JOIN qqbot_plugin p ON p.id = v.plugin_id
WHERE p.plugin_key = 'bilibili-card'
  AND v.version = '1.0.0'
  AND v.package_hash = 'bilibili-card:1.0.0'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.pluginKey')) = 'bilibili-card'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.runtime.workerType')) = 'thread'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.events[0].key')) = 'bilibili-card.message';

SELECT 'seed_qqbot_plugin_installation_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin_installation i
JOIN qqbot_plugin p ON p.id = i.plugin_id
JOIN qqbot_plugin_version v ON v.id = i.version_id
WHERE p.plugin_key = 'bilibili-card'
  AND v.version = '1.0.0'
  AND i.status = 'enabled'
  AND i.runtime_status = 'stopped'
  AND i.installed_path = 'src/modules/qqbot/plugins/bilibili-card';

SELECT 'seed_qqbot_plugin_event_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_plugin_event_handler h
JOIN qqbot_plugin p ON p.id = h.plugin_id
WHERE p.plugin_key = 'bilibili-card'
  AND h.event_key = 'bilibili-card.message'
  AND h.handler_name = 'handleMessage'
  AND h.enabled = 1;

SELECT 'seed_qqbot_command_bangdream_song' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_command
WHERE command_key = 'bangdream_song'
  AND operation_key = 'bangdream.song.search'
  AND plugin_key = 'bangdream'
  AND enabled = 1;

SELECT 'seed_qqbot_command_bangdream_all' AS check_name, COUNT(*) AS matched_rows
FROM qqbot_command
WHERE plugin_key = 'bangdream'
  AND operation_key LIKE 'bangdream.%'
  AND enabled = 1
  AND is_deleted = 0;

SELECT 'index_admin_user_username' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_user'
  AND index_name = 'uk_admin_user_username';

SELECT 'index_platform_setting_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'platform_setting'
  AND index_name = 'uk_platform_setting_key';

SELECT 'index_admin_dict_code_value' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_dict'
  AND index_name = 'uk_admin_dict_code_value';

SELECT 'index_qqbot_command_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_command'
  AND index_name = 'uk_qqbot_command_key';

SELECT 'index_napcat_device_identity_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_device_identity'
  AND index_name = 'uk_napcat_device_identity_account';

SELECT 'index_napcat_account_binding_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_account_binding'
  AND index_name = 'uk_napcat_account_binding_account';

SELECT 'index_napcat_account_binding_container' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_account_binding'
  AND index_name = 'idx_napcat_account_binding_container';

SELECT 'index_napcat_container_name' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_container'
  AND index_name = 'uk_napcat_container_name';

SELECT 'index_napcat_login_session_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_login_session'
  AND index_name = 'uk_napcat_login_session_key';

SELECT 'index_napcat_login_challenge_session' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_login_challenge'
  AND index_name = 'idx_napcat_login_challenge_session';

SELECT 'index_napcat_runtime_cleanup_session' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_runtime_cleanup'
  AND index_name = 'idx_napcat_runtime_cleanup_session';

SELECT 'index_napcat_runtime_profile_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_runtime_profile'
  AND index_name = 'idx_napcat_runtime_profile_account';

SELECT 'index_napcat_runtime_profile_container' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_runtime_profile'
  AND index_name = 'idx_napcat_runtime_profile_container';

SELECT 'index_napcat_protocol_profile_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_protocol_profile'
  AND index_name = 'idx_napcat_protocol_profile_account';

SELECT 'index_napcat_protocol_profile_container' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_protocol_profile'
  AND index_name = 'idx_napcat_protocol_profile_container';

SELECT 'index_napcat_session_behavior_profile_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_session_behavior_profile'
  AND index_name = 'idx_napcat_session_behavior_profile_account';

SELECT 'index_napcat_login_event_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_login_event'
  AND index_name = 'idx_napcat_login_event_account';

SELECT 'index_napcat_login_event_container' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_login_event'
  AND index_name = 'idx_napcat_login_event_container';

SELECT 'index_napcat_risk_mode_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_risk_mode'
  AND index_name = 'uk_napcat_risk_mode_account';

SELECT 'index_napcat_risk_mode_mode' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_risk_mode'
  AND index_name = 'idx_napcat_risk_mode_mode';

SELECT 'column_napcat_login_challenge_session_id_varchar' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_login_challenge'
  AND column_name = 'session_id'
  AND column_type = 'varchar(64)';

SELECT 'column_napcat_runtime_cleanup_session_id_varchar' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_runtime_cleanup'
  AND column_name = 'session_id'
  AND column_type = 'varchar(64)';

SELECT 'column_napcat_device_identity_hostname_strategy' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_device_identity'
  AND column_name = 'hostname_strategy'
  AND column_type = 'varchar(64)';

SELECT 'column_napcat_device_identity_mac_strategy' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_device_identity'
  AND column_name = 'mac_strategy'
  AND column_type = 'varchar(64)';

SELECT 'column_napcat_account_binding_device_identity_id' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_account_binding'
  AND column_name = 'device_identity_id'
  AND column_type = 'bigint';
