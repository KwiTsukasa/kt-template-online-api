-- Series-first expand/backfill/contract migration.
-- Run the version-aware 17/19-table backup drill before execution. This script never guesses movie membership.

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

SET @series_namespace_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND column_name = 'canonical_namespace'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_series` ADD COLUMN `canonical_namespace` varchar(16) NULL AFTER `canonical_provider`'
);
PREPARE series_namespace_stmt FROM @series_namespace_sql;
EXECUTE series_namespace_stmt;
DEALLOCATE PREPARE series_namespace_stmt;

UPDATE `media_governance_series`
SET `canonical_namespace` = CASE
  WHEN `canonical_provider` = 'bangumi' THEN 'subject'
  WHEN `media_type` = 'tv' THEN 'tv'
  ELSE 'movie'
END
WHERE `canonical_namespace` IS NULL OR `canonical_namespace` = '';

SET @series_primary_work_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND column_name = 'primary_work_id'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_series` ADD COLUMN `primary_work_id` varchar(96) NULL AFTER `media_type`'
);
PREPARE series_primary_work_stmt FROM @series_primary_work_sql;
EXECUTE series_primary_work_stmt;
DEALLOCATE PREPARE series_primary_work_stmt;

SET @season_work_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_season'
      AND column_name = 'work_id'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_season` ADD COLUMN `work_id` varchar(96) NULL AFTER `series_id`'
);
PREPARE season_work_stmt FROM @season_work_sql;
EXECUTE season_work_stmt;
DEALLOCATE PREPARE season_work_stmt;

SET @task_context_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'work_id'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_task` ADD COLUMN `series_id` varchar(96) NULL AFTER `work_item_id`, ADD COLUMN `work_id` varchar(96) NULL AFTER `series_id`, ADD COLUMN `operation_kind` varchar(32) NULL AFTER `work_id`, ADD KEY `idx_media_governance_task_series` (`series_id`), ADD KEY `idx_media_governance_task_work` (`work_id`)'
);
PREPARE task_context_stmt FROM @task_context_sql;
EXECUTE task_context_stmt;
DEALLOCATE PREPARE task_context_stmt;

INSERT INTO `media_governance_work` (
  `id`, `series_id`, `canonical_provider`, `canonical_namespace`,
  `canonical_provider_id`, `title`, `original_title`, `release_year`,
  `work_type`, `revision`, `status`
)
SELECT
  CONCAT('media-work-', LEFT(SHA2(CONCAT('primary:', series.`id`), 256), 36)),
  series.`id`,
  series.`canonical_provider`,
  series.`canonical_namespace`,
  series.`canonical_provider_id`,
  series.`title`,
  series.`original_title`,
  series.`release_year`,
  series.`media_type`,
  1,
  series.`status`
FROM `media_governance_series` AS series
LEFT JOIN `media_governance_work` AS work
  ON work.`canonical_provider` = series.`canonical_provider`
 AND work.`canonical_namespace` = series.`canonical_namespace`
 AND work.`canonical_provider_id` = series.`canonical_provider_id`
WHERE work.`id` IS NULL;

UPDATE `media_governance_series` AS series
JOIN `media_governance_work` AS work
  ON work.`series_id` = series.`id`
 AND work.`canonical_provider` = series.`canonical_provider`
 AND work.`canonical_provider_id` = series.`canonical_provider_id`
SET series.`primary_work_id` = work.`id`
WHERE series.`primary_work_id` IS NULL;

UPDATE `media_governance_season` AS season
JOIN `media_governance_series` AS series ON series.`id` = season.`series_id`
SET season.`work_id` = series.`primary_work_id`
WHERE season.`work_id` IS NULL;

INSERT INTO `media_governance_work_external_ref` (
  `id`, `work_id`, `provider`, `provider_namespace`, `provider_id`,
  `reference_role`, `title`, `release_year`
)
SELECT
  CONCAT('media-work-ref-', LEFT(SHA2(CONCAT('legacy-ref:', reference.`id`), 256), 36)),
  series.`primary_work_id`,
  reference.`provider`,
  CASE
    WHEN reference.`provider` = 'bangumi' THEN 'subject'
    WHEN series.`media_type` = 'tv' THEN 'tv'
    ELSE 'movie'
  END,
  reference.`provider_id`,
  reference.`reference_role`,
  reference.`title`,
  reference.`release_year`
FROM `media_governance_series_external_ref` AS reference
JOIN `media_governance_series` AS series ON series.`id` = reference.`series_id`
LEFT JOIN `media_governance_work_external_ref` AS work_reference
  ON work_reference.`provider` = reference.`provider`
 AND work_reference.`provider_namespace` = CASE
   WHEN reference.`provider` = 'bangumi' THEN 'subject'
   WHEN series.`media_type` = 'tv' THEN 'tv'
   ELSE 'movie'
 END
 AND work_reference.`provider_id` = reference.`provider_id`
WHERE work_reference.`id` IS NULL;

UPDATE `media_governance_task` AS task
JOIN (
  SELECT binding.`task_id`, MIN(season.`work_id`) AS work_id
  FROM `media_governance_task_episode_binding` AS binding
  JOIN `media_governance_season` AS season ON season.`id` = binding.`season_id`
  GROUP BY binding.`task_id`
  HAVING COUNT(DISTINCT season.`work_id`) = 1
) AS resolved ON resolved.`task_id` = task.`id`
JOIN `media_governance_work` AS work ON work.`id` = resolved.`work_id`
SET task.`series_id` = work.`series_id`,
    task.`work_id` = work.`id`,
    task.`operation_kind` = COALESCE(task.`operation_kind`, 'legacy-pipeline')
WHERE task.`work_id` IS NULL;

SET @series_without_primary_work := (
  SELECT COUNT(*) FROM `media_governance_series` WHERE `primary_work_id` IS NULL
);
SET @season_without_work := (
  SELECT COUNT(*) FROM `media_governance_season` WHERE `work_id` IS NULL
);
SET @legacy_reference_without_work_ref := (
  SELECT COUNT(*)
  FROM `media_governance_series_external_ref` AS reference
  JOIN `media_governance_series` AS series ON series.`id` = reference.`series_id`
  WHERE NOT EXISTS (
    SELECT 1
    FROM `media_governance_work` AS work
    JOIN `media_governance_work_external_ref` AS work_reference
      ON work_reference.`work_id` = work.`id`
    WHERE work.`series_id` = series.`id`
      AND work_reference.`provider` = reference.`provider`
      AND work_reference.`provider_namespace` = CASE
        WHEN reference.`provider` = 'bangumi' THEN 'subject'
        WHEN series.`media_type` = 'tv' THEN 'tv'
        ELSE 'movie'
      END
      AND work_reference.`provider_id` = reference.`provider_id`
  )
);
SET @series_work_guard_sql := IF(
  @series_without_primary_work = 0
    AND @season_without_work = 0
    AND @legacy_reference_without_work_ref = 0,
  'SELECT 1',
  "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'series-work backfill incomplete'"
);
PREPARE series_work_guard_stmt FROM @series_work_guard_sql;
EXECUTE series_work_guard_stmt;
DEALLOCATE PREPARE series_work_guard_stmt;

SET @series_primary_work_index_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND index_name = 'uk_media_governance_series_primary_work'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_series` ADD UNIQUE KEY `uk_media_governance_series_primary_work` (`primary_work_id`)'
);
PREPARE series_primary_work_index_stmt FROM @series_primary_work_index_sql;
EXECUTE series_primary_work_index_stmt;
DEALLOCATE PREPARE series_primary_work_index_stmt;

SET @series_canonical_index_drop_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND index_name = 'uk_media_governance_series_canonical'
  ) AND NOT EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND index_name = 'uk_media_governance_series_canonical'
      AND column_name = 'canonical_namespace'
  ),
  'ALTER TABLE `media_governance_series` DROP INDEX `uk_media_governance_series_canonical`',
  'SELECT 1'
);
PREPARE series_canonical_index_drop_stmt FROM @series_canonical_index_drop_sql;
EXECUTE series_canonical_index_drop_stmt;
DEALLOCATE PREPARE series_canonical_index_drop_stmt;

SET @series_canonical_index_add_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_series'
      AND index_name = 'uk_media_governance_series_canonical'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_series` ADD UNIQUE KEY `uk_media_governance_series_canonical` (`canonical_provider`, `canonical_namespace`, `canonical_provider_id`)'
);
PREPARE series_canonical_index_add_stmt FROM @series_canonical_index_add_sql;
EXECUTE series_canonical_index_add_stmt;
DEALLOCATE PREPARE series_canonical_index_add_stmt;

SET @season_identity_drop_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_season'
      AND index_name = 'uk_media_governance_season_identity'
      AND column_name = 'series_id'
  ),
  'ALTER TABLE `media_governance_season` DROP INDEX `uk_media_governance_season_identity`',
  'SELECT 1'
);
PREPARE season_identity_drop_stmt FROM @season_identity_drop_sql;
EXECUTE season_identity_drop_stmt;
DEALLOCATE PREPARE season_identity_drop_stmt;

SET @season_identity_add_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_season'
      AND index_name = 'uk_media_governance_season_identity'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_season` ADD UNIQUE KEY `uk_media_governance_season_identity` (`work_id`, `season_number`), ADD KEY `idx_media_governance_season_series_work` (`series_id`, `work_id`)'
);
PREPARE season_identity_add_stmt FROM @season_identity_add_sql;
EXECUTE season_identity_add_stmt;
DEALLOCATE PREPARE season_identity_add_stmt;

ALTER TABLE `media_governance_series`
  MODIFY COLUMN `canonical_namespace` varchar(16) NOT NULL,
  MODIFY COLUMN `primary_work_id` varchar(96) NOT NULL;
ALTER TABLE `media_governance_season`
  MODIFY COLUMN `work_id` varchar(96) NOT NULL;
