SELECT
  COUNT(*) AS work_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'media_governance_work',
    'media_governance_work_external_ref'
  );

SELECT
  (
    (NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_series'
        AND column_name = 'canonical_namespace'
        AND is_nullable = 'NO'
    ))
    + (NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_series'
        AND column_name = 'primary_work_id'
        AND is_nullable = 'NO'
    ))
    + (NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_season'
        AND column_name = 'work_id'
        AND is_nullable = 'NO'
    ))
    + (
      3 - (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'media_governance_task'
          AND column_name IN ('series_id', 'work_id', 'operation_kind')
      )
    )
    + (NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_series'
        AND index_name = 'uk_media_governance_series_primary_work'
        AND non_unique = 0
    ))
    + (NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_series'
        AND index_name = 'uk_media_governance_series_canonical'
        AND non_unique = 0
      GROUP BY index_name
      HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) =
        'canonical_provider,canonical_namespace,canonical_provider_id'
    ))
    + (NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_work'
        AND index_name = 'uk_media_governance_work_canonical'
        AND non_unique = 0
      GROUP BY index_name
      HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) =
        'canonical_provider,canonical_namespace,canonical_provider_id'
    ))
    + (NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_work_external_ref'
        AND index_name = 'uk_media_governance_work_external_ref'
        AND non_unique = 0
      GROUP BY index_name
      HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) =
        'provider,provider_namespace,provider_id'
    ))
    + (NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_season'
        AND index_name = 'uk_media_governance_season_identity'
        AND non_unique = 0
      GROUP BY index_name
      HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) =
        'work_id,season_number'
    ))
    + (NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_task'
        AND index_name = 'idx_media_governance_task_series'
    ))
    + (NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'media_governance_task'
        AND index_name = 'idx_media_governance_task_work'
    ))
  ) AS schema_contract_mismatch_count;

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
