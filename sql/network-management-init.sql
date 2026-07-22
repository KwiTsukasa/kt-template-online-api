-- 通用端口转发控制面数据表与单 Agent 初始状态。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `network_port_forward` (
  `id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `remark` TEXT NULL,
  `protocol` VARCHAR(8) NOT NULL,
  `external_port` INT UNSIGNED NOT NULL,
  `internal_port` INT UNSIGNED NOT NULL,
  `active_key` VARCHAR(32) NULL,
  `target_ipv4` VARCHAR(15) NOT NULL,
  `desired_presence` VARCHAR(16) NOT NULL DEFAULT 'present',
  `keeper_desired_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `probe_request_id` VARCHAR(64) NULL,
  `desired_revision` BIGINT NOT NULL DEFAULT 0,
  `desired_issued_at` DATETIME(6) NOT NULL,
  `reported_revision` BIGINT NOT NULL DEFAULT 0,
  `sync_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `keeper_status` VARCHAR(16) NOT NULL DEFAULT 'disabled',
  `current_public_ipv4` VARCHAR(15) NULL,
  `current_public_port` INT NULL,
  `current_observed_at` DATETIME(6) NULL,
  `current_valid_until` DATETIME(6) NULL,
  `last_observed_ipv4` VARCHAR(15) NULL,
  `last_observed_port` INT NULL,
  `last_observed_at` DATETIME(6) NULL,
  `last_error_code` VARCHAR(64) NULL,
  `last_error_message` VARCHAR(512) NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_network_port_forward_active_key` (`active_key`),
  KEY `idx_network_port_forward_status` (`is_deleted`, `sync_status`),
  KEY `idx_network_port_forward_protocol` (`protocol`, `external_port`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `network_agent_state` (
  `agent_id` VARCHAR(64) NOT NULL,
  `target_ipv4` VARCHAR(15) NOT NULL,
  `desired_revision` BIGINT NOT NULL DEFAULT 0,
  `desired_issued_at` DATETIME(6) NOT NULL,
  `published_revision` BIGINT NOT NULL DEFAULT 0,
  `applied_revision` BIGINT NOT NULL DEFAULT 0,
  `online` TINYINT(1) NOT NULL DEFAULT 0,
  `version` VARCHAR(64) NULL,
  `started_at` DATETIME(6) NULL,
  `last_heartbeat_at` DATETIME(6) NULL,
  `last_mqtt_error_code` VARCHAR(64) NULL,
  `last_mqtt_error_message` VARCHAR(500) NULL,
  `last_reconcile_error_code` VARCHAR(64) NULL,
  `last_reconcile_error_message` VARCHAR(500) NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `network_endpoint_history` (
  `id` BIGINT NOT NULL,
  `event_id` VARCHAR(128) NOT NULL,
  `mapping_id` BIGINT NOT NULL,
  `event_type` VARCHAR(16) NOT NULL,
  `public_ipv4` VARCHAR(15) NULL,
  `public_port` INT NULL,
  `first_observed_at` DATETIME(6) NOT NULL,
  `last_observed_at` DATETIME(6) NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `reason` VARCHAR(128) NULL,
  `create_time` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_network_endpoint_history_event_id` (`event_id`),
  KEY `idx_network_endpoint_history_mapping` (`mapping_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `network_agent_state` (
  `agent_id`, `target_ipv4`, `desired_revision`, `desired_issued_at`, `published_revision`, `applied_revision`, `online`
)
VALUES ('nas-main', '192.168.31.224', 0, CURRENT_TIMESTAMP(6), 0, 0, 0)
ON DUPLICATE KEY UPDATE
  `agent_id` = VALUES(`agent_id`);
