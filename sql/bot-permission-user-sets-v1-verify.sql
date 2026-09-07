SELECT COUNT(*) AS permission_user_set_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name IN ('bot_allowlist', 'bot_blocklist')
  AND column_name = 'user_ids' AND data_type = 'json' AND is_nullable = 'YES';

SELECT (
  (SELECT COUNT(*) FROM bot_allowlist WHERE user_ids IS NULL OR JSON_TYPE(user_ids) <> 'ARRAY')
  + (SELECT COUNT(*) FROM bot_blocklist WHERE user_ids IS NULL OR JSON_TYPE(user_ids) <> 'ARRAY')
) AS permission_user_set_invalid_count;
