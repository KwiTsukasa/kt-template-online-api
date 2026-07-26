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
