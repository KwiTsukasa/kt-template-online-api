-- Persist the verified RSS identity that produces future Task snapshots.

SET @rss_identity_provider_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_rss_subscription'
      AND column_name = 'identity_provider'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_rss_subscription` ADD COLUMN `identity_provider` varchar(16) NULL AFTER `season_id`'
);
PREPARE rss_identity_provider_stmt FROM @rss_identity_provider_sql;
EXECUTE rss_identity_provider_stmt;
DEALLOCATE PREPARE rss_identity_provider_stmt;

SET @rss_identity_provider_id_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_rss_subscription'
      AND column_name = 'identity_provider_id'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_rss_subscription` ADD COLUMN `identity_provider_id` varchar(64) NULL AFTER `identity_provider`'
);
PREPARE rss_identity_provider_id_stmt FROM @rss_identity_provider_id_sql;
EXECUTE rss_identity_provider_id_stmt;
DEALLOCATE PREPARE rss_identity_provider_id_stmt;

SET @rss_identity_title_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_rss_subscription'
      AND column_name = 'identity_title'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_rss_subscription` ADD COLUMN `identity_title` varchar(200) NULL AFTER `identity_provider_id`'
);
PREPARE rss_identity_title_stmt FROM @rss_identity_title_sql;
EXECUTE rss_identity_title_stmt;
DEALLOCATE PREPARE rss_identity_title_stmt;

SET @rss_identity_release_year_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_rss_subscription'
      AND column_name = 'identity_release_year'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_rss_subscription` ADD COLUMN `identity_release_year` int NULL AFTER `identity_title`'
);
PREPARE rss_identity_release_year_stmt FROM @rss_identity_release_year_sql;
EXECUTE rss_identity_release_year_stmt;
DEALLOCATE PREPARE rss_identity_release_year_stmt;

UPDATE `media_governance_rss_subscription` AS subscription
JOIN `media_governance_season` AS season ON season.`id` = subscription.`season_id`
JOIN `media_governance_work` AS work ON work.`id` = season.`work_id`
SET subscription.`identity_provider` = work.`canonical_provider`,
    subscription.`identity_provider_id` = work.`canonical_provider_id`,
    subscription.`identity_title` = work.`title`,
    subscription.`identity_release_year` = work.`release_year`
WHERE subscription.`identity_provider` IS NULL
   OR subscription.`identity_provider_id` IS NULL
   OR subscription.`identity_title` IS NULL;

SET @rss_identity_backfill_missing := (
  SELECT COUNT(*)
  FROM `media_governance_rss_subscription`
  WHERE `identity_provider` IS NULL
     OR `identity_provider_id` IS NULL
     OR `identity_title` IS NULL
);
SET @rss_identity_backfill_guard_sql := IF(
  @rss_identity_backfill_missing = 0,
  'SELECT 1',
  "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rss identity backfill incomplete'"
);
PREPARE rss_identity_backfill_guard_stmt FROM @rss_identity_backfill_guard_sql;
EXECUTE rss_identity_backfill_guard_stmt;
DEALLOCATE PREPARE rss_identity_backfill_guard_stmt;

ALTER TABLE `media_governance_rss_subscription`
  MODIFY COLUMN `identity_provider` varchar(16) NOT NULL,
  MODIFY COLUMN `identity_provider_id` varchar(64) NOT NULL,
  MODIFY COLUMN `identity_title` varchar(200) NOT NULL;

SET @rss_identity_index_sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_rss_subscription'
      AND index_name = 'idx_media_governance_rss_identity'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_rss_subscription` ADD KEY `idx_media_governance_rss_identity` (`identity_provider`, `identity_provider_id`)'
);
PREPARE rss_identity_index_stmt FROM @rss_identity_index_sql;
EXECUTE rss_identity_index_stmt;
DEALLOCATE PREPARE rss_identity_index_stmt;
