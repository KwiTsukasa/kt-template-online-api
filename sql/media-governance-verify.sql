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
    'media_governance_outbox'
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
