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

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_reported_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_reported_at` DATETIME(6) NULL AFTER `reported_revision`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_reported_at_wire'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_reported_at_wire` VARCHAR(64) NULL AFTER `last_reported_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'natmap_last_error_code'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `natmap_last_error_code` VARCHAR(64) NULL AFTER `last_error_message`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'natmap_last_error_message'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `natmap_last_error_message` VARCHAR(512) NULL AFTER `natmap_last_error_code`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'keeper_last_error_code'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `keeper_last_error_code` VARCHAR(64) NULL AFTER `last_error_message`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'keeper_last_error_message'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `keeper_last_error_message` VARCHAR(512) NULL AFTER `keeper_last_error_code`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'candidate_public_ipv4'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `candidate_public_ipv4` VARCHAR(15) NULL AFTER `current_public_port`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'candidate_public_port'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `candidate_public_port` INT NULL AFTER `candidate_public_ipv4`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'candidate_observed_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `candidate_observed_at` DATETIME(6) NULL AFTER `candidate_public_port`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'candidate_validated_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `candidate_validated_at` DATETIME(6) NULL AFTER `candidate_observed_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'current_validated_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `current_validated_at` DATETIME(6) NULL AFTER `current_observed_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_observed_validated_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_observed_validated_at` DATETIME(6) NULL AFTER `last_observed_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'candidate_validated_at_wire'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `candidate_validated_at_wire` VARCHAR(64) NULL AFTER `candidate_validated_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'current_validated_at_wire'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `current_validated_at_wire` VARCHAR(64) NULL AFTER `current_validated_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'current_endpoint_identity'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `current_endpoint_identity` CHAR(64) NULL AFTER `current_valid_until`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_observed_validated_at_wire'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_observed_validated_at_wire` VARCHAR(64) NULL AFTER `last_observed_validated_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_published_public_ipv4'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_published_public_ipv4` VARCHAR(15) NULL AFTER `last_observed_validated_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_published_public_port'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_published_public_port` INT NULL AFTER `last_published_public_ipv4`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'last_published_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_port_forward` ADD COLUMN `last_published_at` DATETIME(6) NULL AFTER `last_published_public_port`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'desired_schema_version'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_agent_state` ADD COLUMN `desired_schema_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `desired_revision`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'published_schema_version'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_agent_state` ADD COLUMN `published_schema_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `published_revision`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'max_supported_schema_version'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_agent_state` ADD COLUMN `max_supported_schema_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `published_schema_version`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'tcp_natmap_capable'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_agent_state` ADD COLUMN `tcp_natmap_capable` TINYINT(1) NOT NULL DEFAULT 0 AFTER `max_supported_schema_version`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'applied_schema_version'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_agent_state` ADD COLUMN `applied_schema_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `applied_revision`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_needs_resize := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'version'
    AND (COLUMN_TYPE <> 'varchar(128)' OR IS_NULLABLE <> 'YES')
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_needs_resize = 1,
  'ALTER TABLE `network_agent_state` MODIFY COLUMN `version` VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_needs_resize := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'last_mqtt_error_message'
    AND (COLUMN_TYPE <> 'varchar(512)' OR IS_NULLABLE <> 'YES')
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_needs_resize = 1,
  'ALTER TABLE `network_agent_state` MODIFY COLUMN `last_mqtt_error_message` VARCHAR(512) NULL',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_needs_resize := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_agent_state'
    AND COLUMN_NAME = 'last_reconcile_error_message'
    AND (COLUMN_TYPE <> 'varchar(512)' OR IS_NULLABLE <> 'YES')
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_needs_resize = 1,
  'ALTER TABLE `network_agent_state` MODIFY COLUMN `last_reconcile_error_message` VARCHAR(512) NULL',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

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

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'source_revision'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_endpoint_history` ADD COLUMN `source_revision` BIGINT NULL AFTER `mechanism`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'endpoint_identity'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_endpoint_history` ADD COLUMN `endpoint_identity` CHAR(64) NULL AFTER `source_revision`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'endpoint_validated_at'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_endpoint_history` ADD COLUMN `endpoint_validated_at` DATETIME(6) NULL AFTER `public_port`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

SET @network_tcp_natmap_v2_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_endpoint_history'
    AND COLUMN_NAME = 'endpoint_valid_until'
);
SET @network_tcp_natmap_v2_alter_sql := IF(
  @network_tcp_natmap_v2_column_exists = 0,
  'ALTER TABLE `network_endpoint_history` ADD COLUMN `endpoint_valid_until` DATETIME(6) NULL AFTER `endpoint_validated_at`',
  'SELECT 1'
);
PREPARE network_tcp_natmap_v2_alter_stmt FROM @network_tcp_natmap_v2_alter_sql;
EXECUTE network_tcp_natmap_v2_alter_stmt;
DEALLOCATE PREPARE network_tcp_natmap_v2_alter_stmt;

INSERT INTO `network_port_forward_group` (
  `id`, `name`, `remark`, `external_port`, `internal_port`, `protocol_mode`,
  `target_ipv4`, `is_deleted`, `create_time`, `update_time`
)
SELECT channel.id, channel.name, channel.remark, channel.external_port,
       channel.internal_port, channel.protocol, channel.target_ipv4, channel.is_deleted,
       channel.create_time, channel.update_time
FROM `network_port_forward` channel
LEFT JOIN `network_port_forward_group` grouped ON grouped.id = channel.id
WHERE channel.group_id IS NULL
  AND grouped.id IS NULL;

UPDATE `network_port_forward` channel
SET `group_id` = channel.id
WHERE channel.group_id IS NULL;

UPDATE `network_port_forward` channel
SET `active_group_protocol_key` = CASE
  WHEN channel.is_deleted = 0 THEN CONCAT(channel.group_id, ':', channel.protocol)
  ELSE NULL
END
WHERE NOT (
  channel.active_group_protocol_key <=> CASE
    WHEN channel.is_deleted = 0 THEN CONCAT(channel.group_id, ':', channel.protocol)
    ELSE NULL
  END
);

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
SET @network_port_forward_group_id_abort_sql := IF(
  @network_port_forward_group_id_null_count = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''network_port_forward.group_id backfill incomplete'''
);
PREPARE network_port_forward_group_id_abort_stmt FROM @network_port_forward_group_id_abort_sql;
EXECUTE network_port_forward_group_id_abort_stmt;
DEALLOCATE PREPARE network_port_forward_group_id_abort_stmt;

SET @network_port_forward_group_id_nullable := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND COLUMN_NAME = 'group_id' AND IS_NULLABLE = 'YES'
);
SET @network_port_forward_group_id_not_null_sql := IF(
  @network_port_forward_group_id_nullable = 1,
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
SET @network_port_forward_active_group_protocol_key_abort_sql := IF(
  @network_port_forward_active_group_protocol_key_conflicts = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''network_port_forward active group/protocol key conflict'''
);
PREPARE network_port_forward_active_group_protocol_key_abort_stmt FROM @network_port_forward_active_group_protocol_key_abort_sql;
EXECUTE network_port_forward_active_group_protocol_key_abort_stmt;
DEALLOCATE PREPARE network_port_forward_active_group_protocol_key_abort_stmt;

SET @network_port_forward_active_group_protocol_key_index_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'network_port_forward'
    AND INDEX_NAME = 'uk_network_port_forward_active_group_protocol_key'
);
SET @network_port_forward_active_group_protocol_key_index_sql := IF(
  @network_port_forward_active_group_protocol_key_index_exists = 0,
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
