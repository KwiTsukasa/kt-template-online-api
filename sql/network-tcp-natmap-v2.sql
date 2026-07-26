-- Additive TCP NATMap v2 group/channel migration. Safe to rerun.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `network_port_forward_group` (
  `id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `remark` TEXT NULL,
  `external_port` INT UNSIGNED NOT NULL,
  `internal_port` INT UNSIGNED NOT NULL,
  `protocol_mode` VARCHAR(8) NOT NULL,
  `target_ipv4` VARCHAR(15) NOT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @network_port_forward_group_id_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'group_id'
);
SET @network_port_forward_group_id_sql := IF(
  @network_port_forward_group_id_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `group_id` BIGINT NULL AFTER `remark`',
  'SELECT 1'
);
PREPARE network_port_forward_group_id_stmt FROM @network_port_forward_group_id_sql;
EXECUTE network_port_forward_group_id_stmt;
DEALLOCATE PREPARE network_port_forward_group_id_stmt;

SET @network_port_forward_active_group_protocol_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'active_group_protocol_key'
);
SET @network_port_forward_active_group_protocol_key_sql := IF(
  @network_port_forward_active_group_protocol_key_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `active_group_protocol_key` VARCHAR(64) NULL AFTER `active_key`',
  'SELECT 1'
);
PREPARE network_port_forward_active_group_protocol_key_stmt FROM @network_port_forward_active_group_protocol_key_sql;
EXECUTE network_port_forward_active_group_protocol_key_stmt;
DEALLOCATE PREPARE network_port_forward_active_group_protocol_key_stmt;

SET @network_port_forward_natmap_desired_enabled_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'natmap_desired_enabled'
);
SET @network_port_forward_natmap_desired_enabled_sql := IF(
  @network_port_forward_natmap_desired_enabled_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `natmap_desired_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `keeper_desired_enabled`',
  'SELECT 1'
);
PREPARE network_port_forward_natmap_desired_enabled_stmt FROM @network_port_forward_natmap_desired_enabled_sql;
EXECUTE network_port_forward_natmap_desired_enabled_stmt;
DEALLOCATE PREPARE network_port_forward_natmap_desired_enabled_stmt;

SET @network_port_forward_natmap_status_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'natmap_status'
);
SET @network_port_forward_natmap_status_sql := IF(
  @network_port_forward_natmap_status_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `natmap_status` VARCHAR(16) NOT NULL DEFAULT ''disabled'' AFTER `keeper_status`',
  'SELECT 1'
);
PREPARE network_port_forward_natmap_status_stmt FROM @network_port_forward_natmap_status_sql;
EXECUTE network_port_forward_natmap_status_stmt;
DEALLOCATE PREPARE network_port_forward_natmap_status_stmt;

SET @network_port_forward_runtime_columns_sql := (
  SELECT GROUP_CONCAT(CONCAT(
    'ADD COLUMN `', column_name, '` ', column_definition, ' ', column_position
  ) SEPARATOR ', ')
  FROM (
    SELECT 'natmap_last_error_code' AS column_name, 'VARCHAR(64) NULL' AS column_definition, 'AFTER `last_error_message`' AS column_position UNION ALL
    SELECT 'natmap_last_error_message', 'VARCHAR(512) NULL', 'AFTER `last_error_message`' UNION ALL
    SELECT 'keeper_last_error_code', 'VARCHAR(64) NULL', 'AFTER `last_error_message`' UNION ALL
    SELECT 'keeper_last_error_message', 'VARCHAR(512) NULL', 'AFTER `last_error_message`' UNION ALL
    SELECT 'candidate_public_ipv4', 'VARCHAR(15) NULL', 'AFTER `current_public_port`' UNION ALL
    SELECT 'candidate_public_port', 'INT NULL', 'AFTER `current_public_port`' UNION ALL
    SELECT 'candidate_observed_at', 'DATETIME(6) NULL', 'AFTER `current_public_port`' UNION ALL
    SELECT 'candidate_validated_at', 'DATETIME(6) NULL', 'AFTER `current_public_port`' UNION ALL
    SELECT 'current_validated_at', 'DATETIME(6) NULL', 'AFTER `current_observed_at`' UNION ALL
    SELECT 'last_observed_validated_at', 'DATETIME(6) NULL', 'AFTER `last_observed_at`' UNION ALL
    SELECT 'last_published_public_ipv4', 'VARCHAR(15) NULL', 'AFTER `last_observed_at`' UNION ALL
    SELECT 'last_published_public_port', 'INT NULL', 'AFTER `last_observed_at`' UNION ALL
    SELECT 'last_published_at', 'DATETIME(6) NULL', 'AFTER `last_observed_at`'
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS actual
    WHERE actual.TABLE_SCHEMA = DATABASE()
      AND actual.TABLE_NAME = 'network_port_forward'
      AND actual.COLUMN_NAME = expected.column_name
  )
);
SET @network_port_forward_runtime_columns_sql := IF(
  @network_port_forward_runtime_columns_sql IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `network_port_forward` ', @network_port_forward_runtime_columns_sql)
);
PREPARE network_port_forward_runtime_columns_stmt FROM @network_port_forward_runtime_columns_sql;
EXECUTE network_port_forward_runtime_columns_stmt;
DEALLOCATE PREPARE network_port_forward_runtime_columns_stmt;

SET @network_agent_state_v2_columns_sql := (
  SELECT GROUP_CONCAT(CONCAT(
    'ADD COLUMN `', column_name, '` ', column_definition, ' ', column_position
  ) SEPARATOR ', ')
  FROM (
    SELECT 'desired_schema_version' AS column_name, 'INT UNSIGNED NOT NULL DEFAULT 1' AS column_definition, 'AFTER `desired_revision`' AS column_position UNION ALL
    SELECT 'published_schema_version', 'INT UNSIGNED NOT NULL DEFAULT 1', 'AFTER `published_revision`' UNION ALL
    SELECT 'max_supported_schema_version', 'INT UNSIGNED NOT NULL DEFAULT 1', 'AFTER `published_revision`' UNION ALL
    SELECT 'tcp_natmap_capable', 'TINYINT(1) NOT NULL DEFAULT 0', 'AFTER `published_revision`'
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS actual
    WHERE actual.TABLE_SCHEMA = DATABASE()
      AND actual.TABLE_NAME = 'network_agent_state'
      AND actual.COLUMN_NAME = expected.column_name
  )
);
SET @network_agent_state_v2_columns_sql := IF(
  @network_agent_state_v2_columns_sql IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE `network_agent_state` ', @network_agent_state_v2_columns_sql)
);
PREPARE network_agent_state_v2_columns_stmt FROM @network_agent_state_v2_columns_sql;
EXECUTE network_agent_state_v2_columns_stmt;
DEALLOCATE PREPARE network_agent_state_v2_columns_stmt;

SET @network_endpoint_history_mechanism_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'mechanism'
);
SET @network_endpoint_history_mechanism_sql := IF(
  @network_endpoint_history_mechanism_exists = 0,
  'ALTER TABLE `network_endpoint_history` ADD COLUMN `mechanism` VARCHAR(16) NULL AFTER `event_type`',
  'SELECT 1'
);
PREPARE network_endpoint_history_mechanism_stmt FROM @network_endpoint_history_mechanism_sql;
EXECUTE network_endpoint_history_mechanism_stmt;
DEALLOCATE PREPARE network_endpoint_history_mechanism_stmt;

INSERT INTO `network_port_forward_group` (
  `id`, `name`, `remark`, `external_port`, `internal_port`, `protocol_mode`,
  `target_ipv4`, `is_deleted`, `create_time`, `update_time`
)
SELECT channel.id, channel.name, channel.remark, channel.external_port,
       channel.internal_port, 'udp', channel.target_ipv4, channel.is_deleted,
       channel.create_time, channel.update_time
FROM `network_port_forward` channel
LEFT JOIN `network_port_forward_group` grouped ON grouped.id = channel.id
WHERE grouped.id IS NULL;

UPDATE `network_port_forward` channel
SET `group_id` = channel.id
WHERE channel.group_id IS NULL;

UPDATE `network_port_forward` channel
SET `active_group_protocol_key` = CASE
  WHEN channel.is_deleted = 0 THEN CONCAT(channel.group_id, ':', channel.protocol)
  ELSE NULL
END
WHERE channel.active_group_protocol_key IS NULL
   OR channel.is_deleted <> 0;

UPDATE `network_endpoint_history`
SET `mechanism` = 'udp_stun'
WHERE `mechanism` IS NULL;

SET @network_endpoint_history_mechanism_nullable := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'mechanism' AND IS_NULLABLE = 'YES'
);
SET @network_endpoint_history_mechanism_sql := IF(
  @network_endpoint_history_mechanism_nullable = 1,
  'ALTER TABLE `network_endpoint_history` MODIFY COLUMN `mechanism` VARCHAR(16) NOT NULL DEFAULT ''udp_stun''',
  'SELECT 1'
);
PREPARE network_endpoint_history_mechanism_not_null_stmt FROM @network_endpoint_history_mechanism_sql;
EXECUTE network_endpoint_history_mechanism_not_null_stmt;
DEALLOCATE PREPARE network_endpoint_history_mechanism_not_null_stmt;

SET @network_port_forward_group_id_null_count := (
  SELECT COUNT(*) FROM `network_port_forward` WHERE `group_id` IS NULL
);
SELECT @network_port_forward_group_id_null_count AS network_port_forward_group_id_null_count;
SET @network_port_forward_group_id_nullable := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'group_id' AND IS_NULLABLE = 'YES'
);
SET @network_port_forward_group_id_not_null_sql := IF(
  @network_port_forward_group_id_null_count = 0
    AND @network_port_forward_group_id_nullable = 1,
  'ALTER TABLE `network_port_forward` MODIFY COLUMN `group_id` BIGINT NOT NULL',
  'SELECT 1'
);
PREPARE network_port_forward_group_id_not_null_stmt FROM @network_port_forward_group_id_not_null_sql;
EXECUTE network_port_forward_group_id_not_null_stmt;
DEALLOCATE PREPARE network_port_forward_group_id_not_null_stmt;

SET @network_port_forward_active_group_protocol_key_conflicts := (
  SELECT COUNT(*) FROM (
    SELECT `active_group_protocol_key`
    FROM `network_port_forward`
    WHERE `active_group_protocol_key` IS NOT NULL
    GROUP BY `active_group_protocol_key`
    HAVING COUNT(*) > 1
  ) conflicts
);
SELECT @network_port_forward_active_group_protocol_key_conflicts AS network_port_forward_active_group_protocol_key_conflicts;
SET @network_port_forward_active_group_protocol_key_index_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND INDEX_NAME = 'uk_network_port_forward_active_group_protocol_key'
);
SET @network_port_forward_active_group_protocol_key_index_sql := IF(
  @network_port_forward_active_group_protocol_key_conflicts = 0
    AND @network_port_forward_active_group_protocol_key_index_exists = 0,
  'ALTER TABLE `network_port_forward` ADD UNIQUE KEY `uk_network_port_forward_active_group_protocol_key` (`active_group_protocol_key`)',
  'SELECT 1'
);
PREPARE network_port_forward_active_group_protocol_key_index_stmt FROM @network_port_forward_active_group_protocol_key_index_sql;
EXECUTE network_port_forward_active_group_protocol_key_index_stmt;
DEALLOCATE PREPARE network_port_forward_active_group_protocol_key_index_stmt;

SET @network_port_forward_group_index_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND INDEX_NAME = 'idx_network_port_forward_group'
);
SET @network_port_forward_group_index_sql := IF(
  @network_port_forward_group_index_exists = 0,
  'ALTER TABLE `network_port_forward` ADD KEY `idx_network_port_forward_group` (`group_id`, `is_deleted`, `protocol`)',
  'SELECT 1'
);
PREPARE network_port_forward_group_index_stmt FROM @network_port_forward_group_index_sql;
EXECUTE network_port_forward_group_index_stmt;
DEALLOCATE PREPARE network_port_forward_group_index_stmt;
