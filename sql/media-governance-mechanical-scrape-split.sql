-- 将媒体治理收口为机械 Task，并把 NAS 刮削校验迁入独立表。
-- 仅允许在数据库备份完成、API/Admin 同版本发布窗口内执行；本文件不由开发测试自动执行。

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

INSERT INTO `media_scrape_validation` (
  `id`, `task_id`, `series_id`, `work_id`, `title`, `media_type`,
  `identity_snapshot`, `governance_snapshot`, `status`, `reason`,
  `issue_projection`, `evidence_sha256`, `governance_revision`, `revision`,
  `requested_at`, `started_at`, `completed_at`
)
SELECT
  CONCAT('media-scrape-', LEFT(SHA2(task.`id`, 256), 64)),
  task.`id`, task.`series_id`, task.`work_id`, task.`title_hint`, task.`media_type`,
  JSON_OBJECT(
    'mediaType', task.`media_type`,
    'providerRef', CASE
      WHEN task.`provider_ref` IS NULL THEN NULL
      WHEN JSON_VALID(task.`provider_ref`) = 1 THEN JSON_EXTRACT(task.`provider_ref`, '$')
      ELSE JSON_OBJECT('legacyRaw', task.`provider_ref`)
    END,
    'metadataIdentity', CASE
      WHEN task.`metadata_identity` IS NULL THEN NULL
      WHEN JSON_VALID(task.`metadata_identity`) = 1 THEN JSON_EXTRACT(task.`metadata_identity`, '$')
      ELSE JSON_OBJECT('legacyRaw', task.`metadata_identity`)
    END,
    'releaseYear', task.`release_year`
  ),
  JSON_OBJECT(
    'closedAt', task.`closed_at`,
    'evidenceSha256s', COALESCE(
      (
        SELECT JSON_ARRAYAGG(unit.`evidence_sha256`)
        FROM `media_governance_unit` AS unit
        WHERE unit.`task_id` = task.`id`
          AND unit.`evidence_sha256` IS NOT NULL
      ),
      JSON_ARRAY()
    ),
    'governanceRevision', task.`revision`,
    'unitIds', COALESCE(
      (
        SELECT JSON_ARRAYAGG(unit.`id`)
        FROM `media_governance_unit` AS unit
        WHERE unit.`task_id` = task.`id`
      ),
      JSON_ARRAY()
    )
  ),
  'pending', NULL, JSON_ARRAY(), NULL, task.`revision`, 1,
  COALESCE(task.`closed_at`, CURRENT_TIMESTAMP(3)), NULL, NULL
FROM `media_governance_task` AS task
WHERE task.`stage` = 'closed'
  AND task.`run_state` = 'succeeded'
  AND NOT EXISTS (
    SELECT 1
    FROM `media_scrape_validation` AS validation
    WHERE validation.`task_id` = task.`id`
  );

DROP TABLE IF EXISTS `media_governance_operator_decision`;
DROP TABLE IF EXISTS `media_governance_metadata_exception`;
DROP TABLE IF EXISTS `media_governance_agent_session`;

SET @drop_media_llm_index_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND index_name = 'uk_media_governance_task_llm_conversation'
  ),
  'ALTER TABLE `media_governance_task` DROP INDEX `uk_media_governance_task_llm_conversation`',
  'SELECT 1'
);
PREPARE drop_media_llm_index_stmt FROM @drop_media_llm_index_sql;
EXECUTE drop_media_llm_index_stmt;
DEALLOCATE PREPARE drop_media_llm_index_stmt;

SET @drop_media_llm_column_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'llm_conversation_id'
  ),
  'ALTER TABLE `media_governance_task` DROP COLUMN `llm_conversation_id`',
  'SELECT 1'
);
PREPARE drop_media_llm_column_stmt FROM @drop_media_llm_column_sql;
EXECUTE drop_media_llm_column_stmt;
DEALLOCATE PREPARE drop_media_llm_column_stmt;

SET @drop_media_metadata_status_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'metadata_status'
  ),
  'ALTER TABLE `media_governance_task` DROP COLUMN `metadata_status`',
  'SELECT 1'
);
PREPARE drop_media_metadata_status_stmt FROM @drop_media_metadata_status_sql;
EXECUTE drop_media_metadata_status_stmt;
DEALLOCATE PREPARE drop_media_metadata_status_stmt;

SET @drop_media_metadata_projection_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_unit'
      AND column_name = 'metadata_projection'
  ),
  'ALTER TABLE `media_governance_unit` DROP COLUMN `metadata_projection`',
  'SELECT 1'
);
PREPARE drop_media_metadata_projection_stmt FROM @drop_media_metadata_projection_sql;
EXECUTE drop_media_metadata_projection_stmt;
DEALLOCATE PREPARE drop_media_metadata_projection_stmt;
