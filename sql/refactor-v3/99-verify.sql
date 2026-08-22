SELECT 'admin_user' AS table_name, COUNT(*) AS row_count FROM admin_user;
SELECT 'admin_role' AS table_name, COUNT(*) AS row_count FROM admin_role;
SELECT 'admin_menu' AS table_name, COUNT(*) AS row_count FROM admin_menu;
SELECT 'network_port_forward' AS table_name, COUNT(*) AS row_count FROM network_port_forward;
SELECT 'network_port_forward_group' AS table_name, COUNT(*) AS row_count FROM network_port_forward_group;
SELECT 'network_ddns_record' AS table_name, COUNT(*) AS row_count FROM network_ddns_record;
SELECT 'network_agent_state' AS table_name, COUNT(*) AS row_count FROM network_agent_state;
SELECT 'network_endpoint_history' AS table_name, COUNT(*) AS row_count FROM network_endpoint_history;
SELECT 'platform_setting' AS table_name, COUNT(*) AS row_count FROM platform_setting;
SELECT 'admin_dict' AS table_name, COUNT(*) AS row_count FROM admin_dict;
SELECT 'bot_command' AS table_name, COUNT(*) AS row_count FROM bot_command;
SELECT 'plugin' AS table_name, COUNT(*) AS row_count FROM plugin;
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
SELECT 'plugin_task' AS table_name, COUNT(*) AS row_count FROM plugin_task;
SELECT 'plugin_task_run' AS table_name, COUNT(*) AS row_count FROM plugin_task_run;
SELECT 'message_subscription' AS table_name, COUNT(*) AS row_count FROM message_subscription;
SELECT 'message_template' AS table_name, COUNT(*) AS row_count FROM message_template;
SELECT 'message_subscription_template' AS table_name, COUNT(*) AS row_count FROM message_subscription_template;
SELECT 'bot_message_publish_binding' AS table_name, COUNT(*) AS row_count FROM bot_message_publish_binding;
SELECT 'bot_message_publish_target' AS table_name, COUNT(*) AS row_count FROM bot_message_publish_target;
SELECT 'message_event' AS table_name, COUNT(*) AS row_count FROM message_event;
SELECT 'bot_message_delivery' AS table_name, COUNT(*) AS row_count FROM bot_message_delivery;
SELECT 'station_notice_message_binding' AS table_name, COUNT(*) AS row_count FROM station_notice_message_binding;

SELECT 'seed_message_template' AS check_name, COUNT(*) AS matched_rows
FROM message_template
WHERE id = 2041700000000200601
  AND BINARY name = BINARY 'STUN 映射端口变更默认模板'
  AND BINARY source_key = BINARY 'network.stun.mapping-port-changed'
  AND BINARY content = BINARY '当前STUN的端口已变更为${{endpoint}}'
  AND enabled = 1
  AND is_deleted = 0;

SELECT 'seed_bot_tcp_natmap_message_template' AS check_name, COUNT(*) AS matched_rows
FROM message_template
WHERE id = 2041700000000200602
  AND BINARY name = BINARY 'TCP NATMap 端点变更默认模板'
  AND BINARY source_key = BINARY 'network.tcp.natmap-endpoint-changed'
  AND BINARY content = BINARY '当前 TCP NATMap 端点已变更为 ${{endpoint}}'
  AND enabled = 1
  AND is_deleted = 0;

WITH expected_menu AS (
  SELECT 2041700000000100420 AS id, 0 AS pid, 'MessageManagement' AS name, NULL AS auth_code
  UNION ALL SELECT 2041700000000100414, 2041700000000100420, 'MessageManagementTemplate', 'MessageManagement:Template:List'
  UNION ALL SELECT 2041700000000100413, 2041700000000100420, 'MessageManagementSubscription', 'MessageManagement:Subscription:List'
  UNION ALL SELECT 2041700000000100423, 2041700000000100420, 'MessageManagementStationNoticeSubscriber', 'MessageManagement:Push:List'
  UNION ALL SELECT 2041700000000120461, 2041700000000100413, 'MessageManagementSubscriptionList', 'MessageManagement:Subscription:List'
  UNION ALL SELECT 2041700000000120462, 2041700000000100413, 'MessageManagementSubscriptionCreate', 'MessageManagement:Subscription:Create'
  UNION ALL SELECT 2041700000000120463, 2041700000000100413, 'MessageManagementSubscriptionUpdate', 'MessageManagement:Subscription:Update'
  UNION ALL SELECT 2041700000000120464, 2041700000000100413, 'MessageManagementSubscriptionDelete', 'MessageManagement:Subscription:Delete'
  UNION ALL SELECT 2041700000000120465, 2041700000000100413, 'MessageManagementSubscriptionToggle', 'MessageManagement:Subscription:Toggle'
  UNION ALL SELECT 2041700000000120471, 2041700000000100414, 'MessageManagementTemplateList', 'MessageManagement:Template:List'
  UNION ALL SELECT 2041700000000120472, 2041700000000100414, 'MessageManagementTemplateCreate', 'MessageManagement:Template:Create'
  UNION ALL SELECT 2041700000000120473, 2041700000000100414, 'MessageManagementTemplateUpdate', 'MessageManagement:Template:Update'
  UNION ALL SELECT 2041700000000120474, 2041700000000100414, 'MessageManagementTemplateDelete', 'MessageManagement:Template:Delete'
  UNION ALL SELECT 2041700000000120475, 2041700000000100414, 'MessageManagementTemplateToggle', 'MessageManagement:Template:Toggle'
  UNION ALL SELECT 2041700000000120476, 2041700000000100414, 'MessageManagementTemplatePreview', 'MessageManagement:Template:Preview'
  UNION ALL SELECT 2041700000000120491, 2041700000000100423, 'MessageManagementPushList', 'MessageManagement:Push:List'
  UNION ALL SELECT 2041700000000120492, 2041700000000100423, 'MessageManagementPushCreate', 'MessageManagement:Push:Create'
  UNION ALL SELECT 2041700000000120493, 2041700000000100423, 'MessageManagementPushUpdate', 'MessageManagement:Push:Update'
  UNION ALL SELECT 2041700000000120494, 2041700000000100423, 'MessageManagementPushDelete', 'MessageManagement:Push:Delete'
  UNION ALL SELECT 2041700000000120495, 2041700000000100423, 'MessageManagementPushToggle', 'MessageManagement:Push:Toggle'
  UNION ALL SELECT 2041700000000120481, 2041700000000100410, 'BotAccountMessagePushList', 'Bot:Account:MessagePush:List'
  UNION ALL SELECT 2041700000000120482, 2041700000000100410, 'BotAccountMessagePushCreate', 'Bot:Account:MessagePush:Create'
  UNION ALL SELECT 2041700000000120483, 2041700000000100410, 'BotAccountMessagePushUpdate', 'Bot:Account:MessagePush:Update'
  UNION ALL SELECT 2041700000000120484, 2041700000000100410, 'BotAccountMessagePushDelete', 'Bot:Account:MessagePush:Delete'
  UNION ALL SELECT 2041700000000120485, 2041700000000100410, 'BotAccountMessagePushToggle', 'Bot:Account:MessagePush:Toggle'
)
SELECT 'seed_message_management_menu_mismatch' AS check_name,
       expected.id, expected.pid, expected.name, expected.auth_code,
       actual.id AS actual_id, actual.pid AS actual_pid, actual.name AS actual_name,
       actual.auth_code AS actual_auth_code, actual.status AS actual_status,
       actual.is_deleted AS actual_is_deleted
FROM expected_menu expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
WHERE actual.id IS NULL
   OR NOT (BINARY actual.name <=> BINARY expected.name)
   OR NOT (BINARY actual.auth_code <=> BINARY expected.auth_code)
   OR actual.pid <> expected.pid
   OR actual.status <> 1
   OR actual.is_deleted <> 0;

WITH expected_menu AS (
  SELECT 2041700000000100420 AS id UNION ALL SELECT 2041700000000100414 UNION ALL SELECT 2041700000000100413
  UNION ALL SELECT 2041700000000100423 UNION ALL SELECT 2041700000000120461 UNION ALL SELECT 2041700000000120462
  UNION ALL SELECT 2041700000000120463 UNION ALL SELECT 2041700000000120464 UNION ALL SELECT 2041700000000120465
  UNION ALL SELECT 2041700000000120471 UNION ALL SELECT 2041700000000120472 UNION ALL SELECT 2041700000000120473
  UNION ALL SELECT 2041700000000120474 UNION ALL SELECT 2041700000000120475 UNION ALL SELECT 2041700000000120476
  UNION ALL SELECT 2041700000000120491 UNION ALL SELECT 2041700000000120492 UNION ALL SELECT 2041700000000120493
  UNION ALL SELECT 2041700000000120494 UNION ALL SELECT 2041700000000120495 UNION ALL SELECT 2041700000000120481
  UNION ALL SELECT 2041700000000120482 UNION ALL SELECT 2041700000000120483 UNION ALL SELECT 2041700000000120484
  UNION ALL SELECT 2041700000000120485
)
SELECT 'seed_message_management_menu_cardinality' AS check_name,
       COUNT(*) AS expected_count, COUNT(actual.id) AS actual_count,
       COUNT(*) - COUNT(actual.id) AS missing_count
FROM expected_menu expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
  AND actual.status = 1
  AND actual.is_deleted = 0;

WITH expected_menu AS (
  SELECT 2041700000000100420 AS id UNION ALL SELECT 2041700000000100414 UNION ALL SELECT 2041700000000100413
  UNION ALL SELECT 2041700000000100423 UNION ALL SELECT 2041700000000120461 UNION ALL SELECT 2041700000000120462
  UNION ALL SELECT 2041700000000120463 UNION ALL SELECT 2041700000000120464 UNION ALL SELECT 2041700000000120465
  UNION ALL SELECT 2041700000000120471 UNION ALL SELECT 2041700000000120472 UNION ALL SELECT 2041700000000120473
  UNION ALL SELECT 2041700000000120474 UNION ALL SELECT 2041700000000120475 UNION ALL SELECT 2041700000000120476
  UNION ALL SELECT 2041700000000120491 UNION ALL SELECT 2041700000000120492 UNION ALL SELECT 2041700000000120493
  UNION ALL SELECT 2041700000000120494 UNION ALL SELECT 2041700000000120495 UNION ALL SELECT 2041700000000120481
  UNION ALL SELECT 2041700000000120482 UNION ALL SELECT 2041700000000120483 UNION ALL SELECT 2041700000000120484
  UNION ALL SELECT 2041700000000120485
)
SELECT 'seed_message_management_menu_role_grant_missing' AS check_name,
       role.role_code, expected.id AS menu_id
FROM admin_role role CROSS JOIN expected_menu expected
LEFT JOIN admin_role_menu role_menu ON role_menu.role_id = role.id AND role_menu.menu_id = expected.id
WHERE role.role_code IN ('super', 'admin')
  AND role.status = 1
  AND role.is_deleted = 0
  AND role_menu.menu_id IS NULL;

WITH expected_menu AS (
  SELECT 2041700000000100400 AS id, 0 AS pid, 'Bot' AS name, '/bot' AS path, NULL AS component, '/bot/dashboard' AS redirect, NULL AS auth_code
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
SELECT 'seed_bot_plugin_menu_mismatch' AS check_name,
       expected.id, expected.pid, expected.name, expected.path,
       actual.id AS actual_id, actual.pid AS actual_pid,
       actual.name AS actual_name, actual.path AS actual_path
FROM expected_menu expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
WHERE actual.id IS NULL
   OR NOT (BINARY actual.name <=> BINARY expected.name)
   OR NOT (BINARY actual.path <=> BINARY expected.path)
   OR NOT (BINARY actual.component <=> BINARY expected.component)
   OR NOT (BINARY actual.redirect <=> BINARY expected.redirect)
   OR NOT (BINARY actual.auth_code <=> BINARY expected.auth_code)
   OR actual.pid <> expected.pid
   OR actual.status <> 1
   OR actual.is_deleted <> 0;

WITH expected_permission AS (
  SELECT 2041700000000120531 AS id
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
SELECT 'seed_bot_plugin_menu_role_grant_missing' AS check_name,
       role.role_code, expected.id AS menu_id
FROM admin_role role CROSS JOIN expected_permission expected
LEFT JOIN admin_role_menu role_menu
  ON role_menu.role_id = role.id
  AND role_menu.menu_id = expected.id
WHERE role.role_code IN ('super', 'admin')
  AND role.status = 1
  AND role.is_deleted = 0
  AND role_menu.menu_id IS NULL;

SELECT 'legacy_bot_menu_contract_count' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE name LIKE 'QqBot%'
   OR path = '/qqbot'
   OR path LIKE '/qqbot/%'
   OR component LIKE '/qqbot/%'
   OR auth_code LIKE 'QqBot:%'
   OR auth_code LIKE 'Bot:PluginTask:%'
   OR path IN ('/bot/plugin', '/bot/plugin-task')
   OR path LIKE '/bot/plugin-platform/%';

SELECT 'seed_plugin_trigger_mode' AS check_name, COUNT(*) AS matched_rows
FROM admin_dict
WHERE dict_code = 'PLUGIN_TRIGGER_MODE'
  AND value IN ('command', 'event')
  AND status = 1
  AND is_deleted = 0;

SELECT 'legacy_plugin_trigger_mode_count' AS check_name, COUNT(*) AS matched_rows
FROM admin_dict
WHERE dict_code IN (
  'QQBOT_PLUGIN_TRIGGER_MODE',
  'BOT_PLUGIN_TRIGGER_MODE'
);

SELECT 'legacy_bot_subscription_key_count' AS check_name, COUNT(*) AS matched_rows
FROM message_subscription
WHERE subscriber_key = 'qqbot'
   OR active_key LIKE 'qqbot:%';

SELECT 'legacy_napcat_reverse_ws_path_count' AS check_name, COUNT(*) AS matched_rows
FROM napcat_container
WHERE reverse_ws_url LIKE '%/qqbot/onebot/reverse%';

SELECT 'legacy_bot_table_count' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name REGEXP '^qqbot_';

SELECT 'legacy_bot_index_count' AS check_name, COUNT(DISTINCT index_name) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND index_name LIKE '%qqbot%';

SELECT 'napcat_webui_gateway_audit table exists' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_webui_gateway_audit';

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

SELECT 'seed_network_agent_state' AS check_name, COUNT(*) AS matched_rows
FROM network_agent_state
WHERE agent_id = 'nas-main'
  AND target_ipv4 = '192.168.31.224';

SELECT 'column_network_agent_state_current_public_ipv6' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'network_agent_state'
  AND column_name = 'current_public_ipv6'
  AND column_type = 'varchar(45)';

SELECT 'column_network_agent_state_current_ipv6_observed_at' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'network_agent_state'
  AND column_name = 'current_ipv6_observed_at'
  AND column_type = 'datetime(3)';

SELECT 'index_network_port_forward_active_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_port_forward'
  AND index_name = 'uk_network_port_forward_active_key';

SELECT 'index_network_port_forward_active_group_protocol_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_port_forward'
  AND index_name = 'uk_network_port_forward_active_group_protocol_key'
  AND non_unique = 0;

SELECT 'network_port_forward_active_group_protocol_key_conflicts' AS check_name, COUNT(*) AS invalid_rows
FROM (
  SELECT active_group_protocol_key
  FROM network_port_forward
  WHERE active_group_protocol_key IS NOT NULL
  GROUP BY active_group_protocol_key
  HAVING COUNT(*) > 1
) conflicts;

SELECT 'network_endpoint_history_mechanism_values' AS check_name, COUNT(*) AS invalid_rows
FROM network_endpoint_history
WHERE mechanism NOT IN ('udp_stun', 'tcp_natmap');

SELECT 'index_network_ddns_record_active_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_ddns_record'
  AND index_name = 'uk_network_ddns_record_active_key'
  AND non_unique = 0;

SELECT 'index_network_ddns_record_status' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_ddns_record'
  AND index_name = 'idx_network_ddns_record_status';

SELECT 'index_network_ddns_record_port_forward' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_ddns_record'
  AND index_name = 'idx_network_ddns_record_port_forward';

SELECT 'index_network_endpoint_history_event_id' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'network_endpoint_history'
  AND index_name = 'uk_network_endpoint_history_event_id';

SELECT 'seed_plugin_bangdream' AS check_name, COUNT(*) AS matched_rows
FROM plugin
WHERE plugin_key = 'bangdream'
  AND status = 'installed';

SELECT 'seed_plugin_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM plugin
WHERE plugin_key = 'bilibili-card'
  AND status = 'installed';

SELECT 'seed_plugin_version_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM plugin_version v
JOIN plugin p ON p.id = v.plugin_id
WHERE p.plugin_key = 'bilibili-card'
  AND v.version = '1.0.0'
  AND v.package_hash = 'bilibili-card:1.0.0'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.pluginKey')) = 'bilibili-card'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.runtime.workerType')) = 'thread'
  AND JSON_UNQUOTE(JSON_EXTRACT(v.manifest_json, '$.events[0].key')) = 'bilibili-card.message';

SELECT 'seed_plugin_installation_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM plugin_installation i
JOIN plugin p ON p.id = i.plugin_id
JOIN plugin_version v ON v.id = i.version_id
WHERE p.plugin_key = 'bilibili-card'
  AND v.version = '1.0.0'
  AND i.status = 'enabled'
  AND i.runtime_status = 'stopped'
  AND i.installed_path = 'src/modules/plugins/bilibili-card';

SELECT 'seed_plugin_event_bilibili_card' AS check_name, COUNT(*) AS matched_rows
FROM plugin_event_handler h
JOIN plugin p ON p.id = h.plugin_id
WHERE p.plugin_key = 'bilibili-card'
  AND h.event_key = 'bilibili-card.message'
  AND h.handler_name = 'handleMessage'
  AND h.enabled = 1;

SELECT 'seed_bot_command_bangdream_song' AS check_name, COUNT(*) AS matched_rows
FROM bot_command
WHERE command_key = 'bangdream_song'
  AND operation_key = 'bangdream.song.search'
  AND plugin_key = 'bangdream'
  AND enabled = 1;

SELECT 'seed_bot_command_bangdream_all' AS check_name, COUNT(*) AS matched_rows
FROM bot_command
WHERE plugin_key = 'bangdream'
  AND operation_key LIKE 'bangdream.%'
  AND enabled = 1
  AND is_deleted = 0;

SELECT 'seed_bot_account_webui_permission' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE auth_code = 'Bot:Account:WebUI';

SELECT 'seed_network_ddns_permissions' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE auth_code IN (
  'System:Network:Ddns:List',
  'System:Network:Ddns:Create',
  'System:Network:Ddns:Update',
  'System:Network:Ddns:Delete',
  'System:Network:Ddns:Retry'
)
  AND status = 1
  AND is_deleted = 0;

SELECT 'seed_network_ddns_super_permissions' AS check_name, COUNT(*) AS matched_rows
FROM admin_role_menu role_menu
JOIN admin_role role ON role.id = role_menu.role_id
JOIN admin_menu menu ON menu.id = role_menu.menu_id
WHERE role.role_code = 'super'
  AND role.status = 1
  AND role.is_deleted = 0
  AND menu.auth_code IN (
    'System:Network:Ddns:List',
    'System:Network:Ddns:Create',
    'System:Network:Ddns:Update',
    'System:Network:Ddns:Delete',
    'System:Network:Ddns:Retry'
  )
  AND menu.status = 1
  AND menu.is_deleted = 0;

SELECT 'network_ddns_non_super_permissions_should_be_zero' AS check_name, COUNT(*) AS matched_rows
FROM admin_role_menu role_menu
JOIN admin_role role ON role.id = role_menu.role_id
JOIN admin_menu menu ON menu.id = role_menu.menu_id
WHERE role.role_code <> 'super'
  AND menu.auth_code IN (
    'System:Network:Ddns:List',
    'System:Network:Ddns:Create',
    'System:Network:Ddns:Update',
    'System:Network:Ddns:Delete',
    'System:Network:Ddns:Retry'
  );

SELECT 'seed_network_natmap_permission' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE id = 2041700000000120227
  AND BINARY name = BINARY 'SystemNetworkPortForwardNatmap'
  AND BINARY auth_code = BINARY 'System:Network:PortForward:Natmap'
  AND status = 1
  AND is_deleted = 0;

SELECT 'seed_network_natmap_super_permission' AS check_name, COUNT(*) AS matched_rows
FROM admin_role_menu role_menu
JOIN admin_role role ON role.id = role_menu.role_id
JOIN admin_menu menu ON menu.id = role_menu.menu_id
WHERE role.role_code = 'super'
  AND role.status = 1
  AND role.is_deleted = 0
  AND menu.id = 2041700000000120227
  AND BINARY menu.name = BINARY 'SystemNetworkPortForwardNatmap'
  AND BINARY menu.auth_code = BINARY 'System:Network:PortForward:Natmap'
  AND menu.status = 1
  AND menu.is_deleted = 0;

SELECT 'network_natmap_non_super_permissions_should_be_zero' AS check_name, COUNT(*) AS invalid_rows
FROM admin_role_menu role_menu
JOIN admin_role role ON role.id = role_menu.role_id
JOIN admin_menu menu ON menu.id = role_menu.menu_id
WHERE role.role_code <> 'super'
  AND role.is_deleted = 0
  AND menu.id = 2041700000000120227
  AND menu.is_deleted = 0;

SELECT
  'network_8213_udp_channel_state' AS check_name,
  channel.id,
  channel.group_id,
  channel.name,
  channel.external_port,
  channel.internal_port,
  channel.protocol,
  channel.target_ipv4,
  channel.desired_presence,
  channel.keeper_desired_enabled,
  channel.keeper_status,
  channel.desired_revision,
  channel.reported_revision,
  channel.current_public_ipv4,
  channel.current_public_port,
  channel.last_observed_ipv4,
  channel.last_observed_port,
  channel.is_deleted,
  forwarding.protocol_mode AS group_protocol_mode,
  forwarding.external_port AS group_external_port,
  forwarding.internal_port AS group_internal_port,
  forwarding.target_ipv4 AS group_target_ipv4,
  forwarding.is_deleted AS group_is_deleted
FROM network_port_forward channel
JOIN network_port_forward_group forwarding ON forwarding.id = channel.group_id
WHERE channel.external_port = 8213
  AND channel.protocol = 'udp';

SELECT
  'network_8213_udp_ddns_state' AS check_name,
  ddns.id,
  ddns.port_forward_id,
  ddns.name,
  ddns.record_type,
  ddns.source_type,
  ddns.domain,
  ddns.sub_domain,
  ddns.enabled,
  ddns.sync_status,
  ddns.provider_record_id,
  ddns.source_address,
  ddns.applied_address,
  ddns.retry_count,
  ddns.next_retry_at,
  ddns.last_attempt_at,
  ddns.last_synced_at,
  ddns.last_error_code,
  ddns.last_error_message,
  ddns.is_deleted
FROM network_ddns_record ddns
JOIN network_port_forward channel ON ddns.port_forward_id = channel.id
WHERE ddns.source_type = 'port_forward_ipv4'
  AND channel.external_port = 8213
  AND channel.protocol = 'udp';

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

SELECT 'index_bot_command_key' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bot_command'
  AND index_name = 'uk_bot_command_key';

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
  AND index_name = 'uk_napcat_runtime_profile_container'
  AND non_unique = 0;

SELECT 'index_napcat_protocol_profile_account' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_protocol_profile'
  AND index_name = 'idx_napcat_protocol_profile_account';

SELECT 'index_napcat_protocol_profile_container' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'napcat_protocol_profile'
  AND index_name = 'uk_napcat_protocol_profile_container'
  AND non_unique = 0;

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

SELECT 'llm_table_cardinality' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('admin_llm_config', 'admin_llm_conversation', 'admin_llm_message');

SELECT 'llm_conversation_scene_columns' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_conversation'
  AND column_name IN ('scene', 'scene_ref_id');

SELECT 'llm_conversation_scene_ref_index' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_conversation'
  AND index_name = 'uk_admin_llm_conversation_scene_ref'
  AND non_unique = 0;

SELECT 'llm_message_metadata_column' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_message'
  AND column_name = 'metadata'
  AND data_type = 'json';

SELECT 'llm_menu_cardinality' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE name IN (
  'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
  'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
  'LlmChatUse'
)
  AND status = 1
  AND is_deleted = 0;

SELECT 'llm_chat_keep_alive' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE name = 'LlmChat'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.fullPathKey')) = 'false'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.keepAlive')) = 'true'
  AND status = 1
  AND is_deleted = 0;

SELECT 'llm_super_grant_missing' AS check_name, COUNT(*) AS missing_rows
FROM admin_role role
CROSS JOIN admin_menu menu
LEFT JOIN admin_role_menu role_menu
  ON role_menu.role_id = role.id
 AND role_menu.menu_id = menu.id
WHERE role.role_code = 'super'
  AND role.status = 1
  AND role.is_deleted = 0
  AND menu.name IN (
    'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
    'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
    'LlmChatUse'
  )
  AND menu.is_deleted = 0
  AND role_menu.role_id IS NULL;
