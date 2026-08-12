SELECT
  COUNT(*) AS required_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (
    (table_name = 'media_governance_task' AND column_name IN ('sealed_plan', 'payload_seal'))
    OR (table_name = 'media_governance_outbox' AND column_name = 'sealed_input')
  );

SELECT
  COUNT(*) AS invalid_pending_outbox_count
FROM media_governance_outbox
WHERE sealed_input IS NULL
  AND execution_id IS NULL;
