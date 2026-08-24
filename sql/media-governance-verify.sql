SELECT
  COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'media_governance_task',
    'media_governance_unit',
    'media_governance_source',
    'media_governance_descriptor_revision',
    'media_governance_run',
    'media_governance_event',
    'media_governance_agent_session',
    'media_governance_metadata_exception',
    'media_governance_operator_decision',
    'media_governance_outbox',
    'media_governance_series',
    'media_governance_work',
    'media_governance_work_external_ref',
    'media_governance_series_external_ref',
    'media_governance_season',
    'media_governance_episode',
    'media_governance_task_episode_binding',
    'media_governance_rss_subscription',
    'media_governance_rss_item'
  );

SELECT
  table_name,
  table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name LIKE 'media_governance_%'
ORDER BY table_name;

SELECT
  COUNT(*) AS task_count,
  COALESCE(MAX(revision), 0) AS max_task_revision
FROM media_governance_task;

SELECT
  COUNT(*) AS agent_session_count,
  COALESCE(MAX(last_sequence), 0) AS max_agent_sequence
FROM media_governance_agent_session;

SELECT
  COUNT(*) AS canonical_series_count,
  COUNT(DISTINCT canonical_provider, canonical_namespace, canonical_provider_id) AS canonical_identity_count
FROM media_governance_series;

SELECT
  COUNT(*) AS invalid_series_namespace_count
FROM media_governance_series
WHERE canonical_namespace NOT IN ('movie', 'subject', 'tv');

SELECT
  COUNT(*) AS series_without_primary_work_count
FROM media_governance_series AS series
LEFT JOIN media_governance_work AS work ON work.id = series.primary_work_id
WHERE series.primary_work_id IS NULL
   OR work.id IS NULL
   OR work.series_id <> series.id;

SELECT
  COUNT(*) AS season_work_mismatch_count
FROM media_governance_season AS season
LEFT JOIN media_governance_work AS work ON work.id = season.work_id
WHERE season.work_id IS NULL
   OR work.id IS NULL
   OR work.series_id <> season.series_id;

SELECT
  COUNT(*) - COUNT(DISTINCT canonical_provider, canonical_namespace, canonical_provider_id)
    AS duplicate_work_canonical_count
FROM media_governance_work;

SELECT
  COUNT(*) AS legacy_series_reference_without_work_ref_count
FROM media_governance_series_external_ref AS reference
JOIN media_governance_series AS series ON series.id = reference.series_id
WHERE NOT EXISTS (
  SELECT 1
  FROM media_governance_work AS work
  JOIN media_governance_work_external_ref AS work_reference
    ON work_reference.work_id = work.id
  WHERE work.series_id = series.id
    AND work_reference.provider = reference.provider
    AND work_reference.provider_namespace = CASE
      WHEN reference.provider = 'bangumi' THEN 'subject'
      WHEN series.media_type = 'tv' THEN 'tv'
      ELSE 'movie'
    END
    AND work_reference.provider_id = reference.provider_id
);

SELECT
  COUNT(*) AS non_tv_work_with_season_count
FROM media_governance_season AS season
JOIN media_governance_work AS work ON work.id = season.work_id
WHERE work.work_type <> 'tv';

SELECT
  COUNT(*) AS task_work_series_mismatch_count
FROM media_governance_task AS task
LEFT JOIN media_governance_work AS work ON work.id = task.work_id
WHERE task.work_id IS NOT NULL
  AND (work.id IS NULL OR work.series_id <> task.series_id);

SELECT
  SUM(work_id IS NOT NULL) AS bound_task_count,
  SUM(work_id IS NULL) AS pending_task_count
FROM media_governance_task;

SELECT
  COUNT(*) AS task_episode_binding_count,
  COUNT(DISTINCT task_id, episode_id) AS task_episode_identity_count
FROM media_governance_task_episode_binding;

SELECT
  COUNT(*) AS season_episode_start_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_season'
  AND column_name = 'episode_start'
  AND is_nullable = 'NO';

SELECT
  COUNT(*) AS invalid_season_episode_range_count
FROM (
  SELECT season.id
  FROM media_governance_season AS season
  LEFT JOIN media_governance_episode AS episode
    ON episode.season_id = season.id
  GROUP BY season.id, season.episode_start, season.episode_count
  HAVING COUNT(episode.id) <> season.episode_count
    OR COALESCE(MIN(episode.episode_number), 0) <> season.episode_start
    OR COALESCE(MAX(episode.episode_number), 0) <> season.episode_start + season.episode_count - 1
) AS invalid_season_range;

SELECT
  COUNT(*) AS rss_subscription_count,
  SUM(enabled = 1) AS enabled_rss_subscription_count
FROM media_governance_rss_subscription;

SELECT
  COUNT(*) AS llm_conversation_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_task'
  AND column_name = 'llm_conversation_id';

SELECT
  COUNT(*) AS llm_conversation_unique_index_count
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_task'
  AND index_name = 'uk_media_governance_task_llm_conversation'
  AND non_unique = 0;

SELECT
  COUNT(*) AS nullable_descriptor_manifest_sha256_columns
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_descriptor_revision'
  AND column_name = 'manifest_sha256'
  AND is_nullable = 'YES';

SELECT
  COUNT(*) AS source_selection_columns
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_source'
  AND column_name = 'selected_file_indices';

SELECT
  COUNT(*) AS source_mapping_columns
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_source'
  AND column_name = 'selected_file_mappings';
