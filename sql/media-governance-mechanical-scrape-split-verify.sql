SELECT
  COUNT(*) AS scrape_validation_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'media_scrape_validation';

SELECT
  COUNT(*) AS scrape_validation_required_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_scrape_validation'
  AND column_name IN (
    'id',
    'task_id',
    'series_id',
    'work_id',
    'title',
    'media_type',
    'identity_snapshot',
    'governance_snapshot',
    'status',
    'reason',
    'issue_projection',
    'evidence_sha256',
    'governance_revision',
    'revision',
    'requested_at',
    'started_at',
    'completed_at',
    'create_time',
    'update_time'
  );

SELECT
  COUNT(DISTINCT index_name) AS scrape_validation_task_unique_index_count
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'media_scrape_validation'
  AND column_name = 'task_id'
  AND non_unique = 0;

SELECT
  COUNT(*) AS legacy_media_agent_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'media_governance_agent_session',
    'media_governance_metadata_exception',
    'media_governance_operator_decision'
  );

SELECT
  COUNT(*) AS legacy_media_task_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_task'
  AND column_name IN ('llm_conversation_id', 'metadata_status');

SELECT
  COUNT(*) AS legacy_media_unit_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'media_governance_unit'
  AND column_name = 'metadata_projection';

SELECT
  COUNT(*) AS closed_task_without_scrape_validation_count
FROM media_governance_task AS task
LEFT JOIN media_scrape_validation AS validation ON validation.task_id = task.id
WHERE task.stage = 'closed'
  AND task.run_state = 'succeeded'
  AND validation.id IS NULL;

SELECT
  COUNT(*) AS orphan_scrape_validation_count
FROM media_scrape_validation AS validation
LEFT JOIN media_governance_task AS task ON task.id = validation.task_id
WHERE task.id IS NULL;
