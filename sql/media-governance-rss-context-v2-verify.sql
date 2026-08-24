SELECT
  COUNT(*) AS rss_context_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_rss_subscription'
  AND column_name IN (
    'identity_provider',
    'identity_provider_id',
    'identity_title',
    'identity_release_year'
  );

SELECT
  COUNT(*) AS rss_context_missing_identity_count
FROM media_governance_rss_subscription
WHERE identity_provider IS NULL
   OR identity_provider = ''
   OR identity_provider_id IS NULL
   OR identity_provider_id = ''
   OR identity_title IS NULL
   OR identity_title = '';

SELECT
  COUNT(*) AS rss_context_work_ref_mismatch_count
FROM media_governance_rss_subscription AS subscription
JOIN media_governance_season AS season ON season.id = subscription.season_id
WHERE NOT EXISTS (
  SELECT 1
  FROM media_governance_work_external_ref AS reference
  WHERE reference.work_id = season.work_id
    AND reference.provider = subscription.identity_provider
    AND reference.provider_id = subscription.identity_provider_id
);

SELECT
  COUNT(*) AS rss_context_index_count
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_rss_subscription'
  AND index_name = 'idx_media_governance_rss_identity';
