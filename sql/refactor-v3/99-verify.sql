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
