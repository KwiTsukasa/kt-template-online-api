-- Admin 媒体治理生产状态表。仅创建领域表，不注册菜单、不写媒体数据。
-- 生产执行前必须先备份 schema，并在执行后运行 media-governance-verify.sql。

CREATE TABLE IF NOT EXISTS `media_governance_task` (
  `id` varchar(96) NOT NULL,
  `work_item_id` varchar(96) DEFAULT NULL,
  `series_id` varchar(96) DEFAULT NULL,
  `work_id` varchar(96) DEFAULT NULL,
  `operation_kind` varchar(32) DEFAULT NULL,
  `title_hint` varchar(200) NOT NULL,
  `media_type` varchar(24) NOT NULL,
  `release_year` int DEFAULT NULL,
  `provider_ref` longtext,
  `declared_unit_ids` longtext NOT NULL,
  `stage` varchar(32) NOT NULL,
  `run_state` varchar(32) NOT NULL,
  `gate_reason` varchar(160) DEFAULT NULL,
  `governance_profile` varchar(32) DEFAULT NULL,
  `next_command_label` varchar(160) NOT NULL,
  `progress_projection` longtext NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `active_run_id` varchar(96) DEFAULT NULL,
  `input_snapshot_sha256` varchar(64) NOT NULL,
  `sealed_plan_sha256` varchar(64) DEFAULT NULL,
  `sealed_plan` longtext,
  `payload_seal` longtext,
  `metadata_identity` longtext,
  `closed_mode` varchar(32) DEFAULT NULL,
  `closed_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_task_work_item` (`work_item_id`),
  KEY `idx_media_governance_task_series` (`series_id`),
  KEY `idx_media_governance_task_work` (`work_id`),
  KEY `idx_media_governance_task_stage_state` (`stage`, `run_state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_unit` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `unit_kind` varchar(24) NOT NULL,
  `season_number` varchar(8) DEFAULT NULL,
  `expected_episode_numbers` longtext NOT NULL,
  `subtitle_contract` longtext,
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

CREATE TABLE IF NOT EXISTS `media_scrape_validation` (
  `id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `series_id` varchar(96) DEFAULT NULL,
  `work_id` varchar(96) DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `media_type` varchar(24) NOT NULL,
  `identity_snapshot` longtext NOT NULL,
  `governance_snapshot` longtext NOT NULL,
  `status` varchar(24) NOT NULL,
  `reason` varchar(400) DEFAULT NULL,
  `issue_projection` longtext NOT NULL,
  `evidence_sha256` varchar(64) DEFAULT NULL,
  `governance_revision` int NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `requested_at` datetime(3) NOT NULL,
  `started_at` datetime(3) DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_scrape_validation_task` (`task_id`),
  KEY `idx_media_scrape_validation_status_requested` (`status`, `requested_at`),
  KEY `idx_media_scrape_validation_series` (`series_id`),
  KEY `idx_media_scrape_validation_work` (`work_id`)
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

CREATE TABLE IF NOT EXISTS `media_governance_series` (
  `id` varchar(96) NOT NULL,
  `canonical_provider` varchar(16) NOT NULL,
  `canonical_namespace` varchar(16) NOT NULL,
  `canonical_provider_id` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `original_title` varchar(200) DEFAULT NULL,
  `release_year` int NOT NULL,
  `media_type` varchar(24) NOT NULL,
  `primary_work_id` varchar(96) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `status` varchar(24) NOT NULL DEFAULT 'active',
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_series_canonical` (`canonical_provider`, `canonical_namespace`, `canonical_provider_id`),
  UNIQUE KEY `uk_media_governance_series_primary_work` (`primary_work_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_work` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `canonical_provider` varchar(16) NOT NULL,
  `canonical_namespace` varchar(16) NOT NULL,
  `canonical_provider_id` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `original_title` varchar(200) DEFAULT NULL,
  `release_year` int NOT NULL,
  `work_type` varchar(24) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `status` varchar(24) NOT NULL DEFAULT 'active',
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_work_canonical` (`canonical_provider`, `canonical_namespace`, `canonical_provider_id`),
  KEY `idx_media_governance_work_series` (`series_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_work_external_ref` (
  `id` varchar(96) NOT NULL,
  `work_id` varchar(96) NOT NULL,
  `provider` varchar(16) NOT NULL,
  `provider_namespace` varchar(16) NOT NULL,
  `provider_id` varchar(64) NOT NULL,
  `reference_role` varchar(32) NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `release_year` int DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_work_external_ref` (`provider`, `provider_namespace`, `provider_id`),
  KEY `idx_media_governance_work_external_ref_work` (`work_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_series_external_ref` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `provider` varchar(16) NOT NULL,
  `provider_id` varchar(64) NOT NULL,
  `reference_role` varchar(32) NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `release_year` int DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_series_external_ref` (`provider`, `provider_id`),
  KEY `idx_media_governance_series_external_ref_series` (`series_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_season` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `work_id` varchar(96) NOT NULL,
  `season_number` int NOT NULL,
  `episode_start` int NOT NULL DEFAULT 1,
  `episode_count` int NOT NULL,
  `title` varchar(200) NOT NULL,
  `release_year` int DEFAULT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'known',
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_season_identity` (`work_id`, `season_number`),
  KEY `idx_media_governance_season_series_work` (`series_id`, `work_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_episode` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `season_id` varchar(96) NOT NULL,
  `season_number` int NOT NULL,
  `episode_number` int NOT NULL,
  `title` varchar(200) DEFAULT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'known',
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_episode_identity` (`season_id`, `episode_number`),
  KEY `idx_media_governance_episode_series` (`series_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_task_episode_binding` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `season_id` varchar(96) NOT NULL,
  `episode_id` varchar(96) NOT NULL,
  `task_id` varchar(96) NOT NULL,
  `source_id` varchar(96) DEFAULT NULL,
  `binding_role` varchar(32) NOT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_task_episode` (`task_id`, `episode_id`),
  KEY `idx_media_governance_task_episode_series` (`series_id`),
  KEY `idx_media_governance_task_episode_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_rss_subscription` (
  `id` varchar(96) NOT NULL,
  `series_id` varchar(96) NOT NULL,
  `season_id` varchar(96) NOT NULL,
  `identity_provider` varchar(16) NOT NULL,
  `identity_provider_id` varchar(64) NOT NULL,
  `identity_title` varchar(200) NOT NULL,
  `identity_release_year` int DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `feed_url` varchar(2048) NOT NULL,
  `feed_url_sha256` varchar(64) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `content_kind` varchar(32) NOT NULL,
  `release_group` varchar(160) DEFAULT NULL,
  `include_pattern` varchar(500) DEFAULT NULL,
  `episode_pattern` varchar(500) DEFAULT NULL,
  `poll_interval_minutes` int NOT NULL DEFAULT 15,
  `revision` int NOT NULL DEFAULT 1,
  `status` varchar(24) NOT NULL DEFAULT 'idle',
  `last_error` varchar(500) DEFAULT NULL,
  `last_polled_at` datetime(3) DEFAULT NULL,
  `next_poll_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_rss_subscription_feed` (`series_id`, `feed_url_sha256`),
  KEY `idx_media_governance_rss_identity` (`identity_provider`, `identity_provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_governance_rss_item` (
  `id` varchar(96) NOT NULL,
  `subscription_id` varchar(96) NOT NULL,
  `item_key_sha256` varchar(64) NOT NULL,
  `guid` varchar(512) DEFAULT NULL,
  `title` varchar(512) NOT NULL,
  `info_hash` varchar(40) DEFAULT NULL,
  `episode_number` int DEFAULT NULL,
  `state` varchar(24) NOT NULL DEFAULT 'discovered',
  `state_reason` varchar(500) DEFAULT NULL,
  `task_id` varchar(96) DEFAULT NULL,
  `source_id` varchar(96) DEFAULT NULL,
  `published_at` datetime(3) DEFAULT NULL,
  `create_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_governance_rss_item_key` (`subscription_id`, `item_key_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
