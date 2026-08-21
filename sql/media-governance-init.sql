-- Admin 媒体治理生产状态表。仅创建领域表，不注册菜单、不写媒体数据。
-- 生产执行前必须先备份 schema，并在执行后运行 media-governance-verify.sql。

CREATE TABLE IF NOT EXISTS `media_governance_task` (
  `id` varchar(96) NOT NULL,
  `work_item_id` varchar(96) DEFAULT NULL,
  `title_hint` varchar(200) NOT NULL,
  `media_type` varchar(24) NOT NULL,
  `release_year` int DEFAULT NULL,
  `provider_ref` longtext,
  `declared_unit_ids` longtext NOT NULL,
  `stage` varchar(32) NOT NULL,
  `run_state` varchar(32) NOT NULL,
  `gate_reason` varchar(160) DEFAULT NULL,
  `governance_profile` varchar(32) DEFAULT NULL,
  `metadata_status` varchar(32) NOT NULL,
  `next_command_label` varchar(160) NOT NULL,
  `progress_projection` longtext NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `active_run_id` varchar(96) DEFAULT NULL,
  `input_snapshot_sha256` varchar(64) NOT NULL,
  `sealed_plan_sha256` varchar(64) DEFAULT NULL,
  `sealed_plan` longtext,
  `payload_seal` longtext,
  `metadata_identity` longtext,
  `llm_conversation_id` bigint DEFAULT NULL,
  `closed_mode` varchar(32) DEFAULT NULL,
  `closed_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_task_work_item` (`work_item_id`),
  UNIQUE KEY `uk_media_governance_task_llm_conversation` (`llm_conversation_id`),
  KEY `idx_media_governance_task_stage_state` (`stage`, `run_state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @media_task_llm_conversation_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'llm_conversation_id'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_task` ADD COLUMN `llm_conversation_id` bigint NULL AFTER `metadata_identity`'
);
PREPARE media_task_llm_conversation_stmt FROM @media_task_llm_conversation_sql;
EXECUTE media_task_llm_conversation_stmt;
DEALLOCATE PREPARE media_task_llm_conversation_stmt;

SET @media_task_llm_conversation_index_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND index_name = 'uk_media_governance_task_llm_conversation'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_task` ADD UNIQUE KEY `uk_media_governance_task_llm_conversation` (`llm_conversation_id`)'
);
PREPARE media_task_llm_conversation_index_stmt FROM @media_task_llm_conversation_index_sql;
EXECUTE media_task_llm_conversation_index_stmt;
DEALLOCATE PREPARE media_task_llm_conversation_index_stmt;

CREATE TABLE IF NOT EXISTS `media_governance_unit` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `unit_kind` varchar(24) NOT NULL,
  `season_number` varchar(8) DEFAULT NULL,
  `expected_episode_numbers` longtext NOT NULL,
  `subtitle_contract` longtext,
  `metadata_projection` longtext,
  `local_accepted_at` datetime(3) DEFAULT NULL,
  `evidence_sha256` varchar(64) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_unit_task_season` (`task_id`, `season_number`),
  KEY `idx_media_governance_unit_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_source` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `transport_kind` varchar(24) NOT NULL,
  `source_role` varchar(32) NOT NULL,
  `content_kind` varchar(32) NOT NULL,
  `descriptor_revision` int NOT NULL DEFAULT 1,
  `descriptor_object_id` varchar(512) NOT NULL,
  `descriptor_sha256` varchar(64) NOT NULL,
  `info_hash` varchar(64) DEFAULT NULL,
  `manifest_sha256` varchar(64) DEFAULT NULL,
  `manifest_projection` longtext NOT NULL,
  `manifest_state` varchar(32) NOT NULL,
  `selected_bytes` bigint NOT NULL,
  `selected_file_count` int NOT NULL,
  `selected_file_indices` longtext DEFAULT NULL,
  `selected_file_mappings` longtext DEFAULT NULL,
  `release_group` varchar(160) DEFAULT NULL,
  `season_numbers` longtext NOT NULL,
  `source_health` varchar(32) NOT NULL,
  `source_health_label` varchar(160) NOT NULL,
  `source_health_reason` varchar(400) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_media_governance_source_task` (`task_id`),
  KEY `idx_media_governance_source_info_hash` (`info_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_descriptor_revision` (
  `id` varchar(96) NOT NULL,
  `source_id` varchar(96) NOT NULL,
  `revision` int NOT NULL,
  `object_id` varchar(512) NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `info_hash` varchar(64) DEFAULT NULL,
  `bytes` bigint NOT NULL,
  `manifest_sha256` varchar(64) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `tombstoned_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_descriptor_object` (`object_id`),
  KEY `idx_media_governance_descriptor_source` (`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_run` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `task_revision` int NOT NULL,
  `action` varchar(48) NOT NULL,
  `status` varchar(32) NOT NULL,
  `replay_key` varchar(160) NOT NULL,
  `input_snapshot_sha256` varchar(64) NOT NULL,
  `plan_sha256` varchar(64) DEFAULT NULL,
  `runner_sha256` varchar(64) DEFAULT NULL,
  `progress` longtext NOT NULL,
  `started_at` datetime(3) DEFAULT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `evidence_sha256` varchar(64) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_run_replay` (`replay_key`),
  KEY `idx_media_governance_run_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_event` (
  `id` varchar(96) NOT NULL,
  `event_id` varchar(160) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `run_id` varchar(96) DEFAULT NULL,
  `sequence` int NOT NULL,
  `type` varchar(48) NOT NULL,
  `observed_at` datetime(3) NOT NULL,
  `stage` varchar(32) NOT NULL,
  `run_state` varchar(32) NOT NULL,
  `summary` varchar(400) NOT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_event_id` (`event_id`),
  UNIQUE KEY `uk_media_governance_event_task_run_sequence` (`task_id`, `run_id`, `sequence`),
  KEY `idx_media_governance_event_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_agent_session` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `thread_id` varchar(96) NOT NULL,
  `current_unit_id` varchar(96) DEFAULT NULL,
  `policy_sha256` varchar(64) NOT NULL,
  `capsule_sha256` varchar(64) NOT NULL,
  `checkpoint_sha256` varchar(64) NOT NULL,
  `policy_version` varchar(48) NOT NULL,
  `last_sequence` int NOT NULL DEFAULT 0,
  `pending_plan_sha256` varchar(64) DEFAULT NULL,
  `current_action_label` varchar(400) NOT NULL,
  `status_label` varchar(160) NOT NULL,
  `policy_boundary_label` varchar(240) NOT NULL,
  `status` varchar(32) NOT NULL,
  `last_heartbeat_at` datetime(3) NOT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_agent_task` (`task_id`),
  KEY `idx_media_governance_agent_thread` (`thread_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_metadata_exception` (
  `id` varchar(96) NOT NULL,
  `unit_id` varchar(96) NOT NULL,
  `field_path` varchar(160) NOT NULL,
  `tier` varchar(8) NOT NULL,
  `reason_code` varchar(64) NOT NULL,
  `sources_checked` longtext NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `selected_fallback` longtext,
  `agent_thread_id` varchar(96) DEFAULT NULL,
  `policy_version` varchar(48) NOT NULL,
  `task_revision` int NOT NULL,
  `evidence_sha256` varchar(64) NOT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_media_governance_metadata_unit` (`unit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_operator_decision` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `unit_id` varchar(96) DEFAULT NULL,
  `candidate_snapshot_sha256` varchar(64) NOT NULL,
  `selected_candidate_id` varchar(160) NOT NULL,
  `reason` varchar(400) NOT NULL,
  `previous_revision` int NOT NULL,
  `next_revision` int NOT NULL,
  `verification_run_id` varchar(96) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_media_governance_decision_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_outbox` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `idempotency_key` varchar(160) NOT NULL,
  `flow_id` varchar(96) NOT NULL,
  `sealed_input_sha256` varchar(64) NOT NULL,
  `sealed_input` longtext NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `lease_until` datetime(3) DEFAULT NULL,
  `execution_id` varchar(96) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_outbox_idempotency` (`idempotency_key`),
  KEY `idx_media_governance_outbox_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
