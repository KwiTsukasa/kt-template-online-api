SET NAMES utf8mb4;

SELECT 'llm_table_cardinality' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'admin_llm_config',
    'admin_llm_conversation',
    'admin_llm_message'
  );

SELECT 'llm_config_secret_column' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_config'
  AND column_name = 'api_key_secret'
  AND data_type = 'text';

SELECT 'llm_conversation_scene_columns' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_conversation'
  AND column_name IN ('scene', 'scene_ref_id');

SELECT 'llm_message_metadata_column' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_message'
  AND column_name = 'metadata'
  AND data_type = 'json';

SELECT 'llm_conversation_scene_ref_index' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_conversation'
  AND index_name = 'uk_admin_llm_conversation_scene_ref'
  AND non_unique = 0;

SELECT 'llm_message_sequence_index' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_message'
  AND index_name = 'uk_admin_llm_message_sequence'
  AND non_unique = 0;

SELECT 'llm_message_client_index' AS check_name, COUNT(*) AS matched_rows
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'admin_llm_message'
  AND index_name = 'uk_admin_llm_message_client_id'
  AND non_unique = 0;

SELECT 'llm_menu_cardinality' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE name IN (
  'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
  'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
  'LlmChatUse'
)
  AND is_deleted = 0;

SELECT 'llm_chat_keep_alive' AS check_name, COUNT(*) AS matched_rows
FROM admin_menu
WHERE name = 'LlmChat'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.fullPathKey')) = 'false'
  AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.keepAlive')) = 'true'
  AND status = 1
  AND is_deleted = 0;

SELECT 'llm_menu_mismatch' AS check_name, COUNT(*) AS mismatch_rows
FROM (
  SELECT 2041700000000100500 AS id, 0 AS pid, 'Llm' AS name, '/llm' AS path, NULL AS component, NULL AS auth_code, 'catalog' AS type
  UNION ALL SELECT 2041700000000100501, 2041700000000100500, 'LlmConfig', '/llm/config', '/llm/config/index', 'Llm:Config:List', 'menu'
  UNION ALL SELECT 2041700000000100502, 2041700000000100500, 'LlmChat', '/llm/config/:configId/chat', '/llm/chat/index', 'Llm:Chat:Use', 'menu'
  UNION ALL SELECT 2041700000000120501, 2041700000000100501, 'LlmConfigCreate', NULL, NULL, 'Llm:Config:Create', 'button'
  UNION ALL SELECT 2041700000000120502, 2041700000000100501, 'LlmConfigUpdate', NULL, NULL, 'Llm:Config:Update', 'button'
  UNION ALL SELECT 2041700000000120503, 2041700000000100501, 'LlmConfigDelete', NULL, NULL, 'Llm:Config:Delete', 'button'
  UNION ALL SELECT 2041700000000120504, 2041700000000100501, 'LlmConfigTest', NULL, NULL, 'Llm:Config:Test', 'button'
  UNION ALL SELECT 2041700000000120505, 2041700000000100501, 'LlmConfigDefault', NULL, NULL, 'Llm:Config:Default', 'button'
  UNION ALL SELECT 2041700000000120506, 2041700000000100501, 'LlmConfigToggle', NULL, NULL, 'Llm:Config:Toggle', 'button'
  UNION ALL SELECT 2041700000000120507, 2041700000000100502, 'LlmChatUse', NULL, NULL, 'Llm:Chat:Use', 'button'
) expected
LEFT JOIN admin_menu actual ON actual.id = expected.id
WHERE actual.id IS NULL
   OR actual.pid <> expected.pid
   OR actual.name <> expected.name
   OR NOT (actual.path <=> expected.path)
   OR NOT (actual.component <=> expected.component)
   OR NOT (actual.auth_code <=> expected.auth_code)
   OR actual.type <> expected.type
   OR actual.status <> 1
   OR actual.is_deleted <> 0;

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

SELECT 'llm_non_super_grant_count' AS check_name, COUNT(*) AS matched_rows
FROM admin_role_menu role_menu
JOIN admin_role role ON role.id = role_menu.role_id
JOIN admin_menu menu ON menu.id = role_menu.menu_id
WHERE role.role_code <> 'super'
  AND menu.name IN (
    'Llm', 'LlmConfig', 'LlmChat', 'LlmConfigCreate', 'LlmConfigUpdate',
    'LlmConfigDelete', 'LlmConfigTest', 'LlmConfigDefault', 'LlmConfigToggle',
    'LlmChatUse'
  );
