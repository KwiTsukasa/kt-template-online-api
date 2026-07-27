-- Read-only post-migration verification for TCP NATMap v2.

SELECT 'network_port_forward_group' AS table_name, COUNT(*) AS row_count
FROM `network_port_forward_group`;

SELECT 'network_port_forward_group_id_null_count' AS check_name, COUNT(*) AS matched_rows
FROM `network_port_forward`
WHERE `group_id` IS NULL;

SELECT 'network_port_forward_active_group_protocol_key_conflicts' AS check_name,
       COUNT(*) AS matched_rows
FROM (
  SELECT `active_group_protocol_key`
  FROM `network_port_forward`
  WHERE `active_group_protocol_key` IS NOT NULL
  GROUP BY `active_group_protocol_key`
  HAVING COUNT(*) > 1
) conflicts;

SELECT 'network_port_forward_group_id' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_port_forward'
  AND COLUMN_NAME = 'group_id'
  AND COLUMN_TYPE = 'bigint'
  AND IS_NULLABLE = 'NO';

SELECT 'network_port_forward_last_reported_at' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_port_forward'
  AND COLUMN_NAME = 'last_reported_at'
  AND COLUMN_TYPE = 'datetime(6)'
  AND IS_NULLABLE = 'YES';

SELECT 'network_port_forward_last_reported_at_wire' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_port_forward'
  AND COLUMN_NAME = 'last_reported_at_wire'
  AND COLUMN_TYPE = 'varchar(64)'
  AND IS_NULLABLE = 'YES';

SELECT 'network_port_forward_wire_identity_columns' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_port_forward'
  AND (
    (COLUMN_NAME = 'candidate_validated_at_wire' AND COLUMN_TYPE = 'varchar(64)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'current_validated_at_wire' AND COLUMN_TYPE = 'varchar(64)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'current_endpoint_identity' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'last_observed_validated_at_wire' AND COLUMN_TYPE = 'varchar(64)' AND IS_NULLABLE = 'YES')
  );

SELECT 'network_agent_state_applied_schema_version' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_agent_state'
  AND COLUMN_NAME = 'applied_schema_version'
  AND COLUMN_TYPE = 'int unsigned'
  AND IS_NULLABLE = 'NO'
  AND COLUMN_DEFAULT = '1';

SELECT 'network_agent_state_v2_text_widths' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_agent_state'
  AND (
    (COLUMN_NAME = 'version' AND COLUMN_TYPE = 'varchar(128)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'last_mqtt_error_message' AND COLUMN_TYPE = 'varchar(512)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'last_reconcile_error_message' AND COLUMN_TYPE = 'varchar(512)' AND IS_NULLABLE = 'YES')
  );

SELECT 'network_port_forward_v2_indexes' AS check_name, INDEX_NAME, NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_port_forward'
  AND INDEX_NAME IN (
    'uk_network_port_forward_active_group_protocol_key',
    'idx_network_port_forward_group'
  );

SELECT 'network_endpoint_history_mechanism' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_endpoint_history'
  AND COLUMN_NAME = 'mechanism'
  AND COLUMN_TYPE = 'varchar(16)'
  AND IS_NULLABLE = 'NO';

SELECT 'network_endpoint_history_correlation_columns' AS check_name, COUNT(*) AS matched_rows
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'network_endpoint_history'
  AND (
    (COLUMN_NAME = 'source_revision' AND COLUMN_TYPE = 'bigint' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'endpoint_identity' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'endpoint_validated_at' AND COLUMN_TYPE = 'datetime(6)' AND IS_NULLABLE = 'YES')
    OR (COLUMN_NAME = 'endpoint_valid_until' AND COLUMN_TYPE = 'datetime(6)' AND IS_NULLABLE = 'YES')
  );
