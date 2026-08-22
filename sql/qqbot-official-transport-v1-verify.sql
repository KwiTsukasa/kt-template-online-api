-- QQ 官方 Bot 双 transport 结构只读验收。

SELECT
  column_name,
  column_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_account'
  AND column_name IN (
    'official_app_id',
    'official_app_secret_ciphertext'
  )
ORDER BY column_name;

SELECT
  'qqbot_official_columns' AS check_name,
  COUNT(*) AS matched_columns
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_account'
  AND (
    (
      column_name = 'official_app_id'
      AND column_type = 'varchar(64)'
      AND is_nullable = 'YES'
    )
    OR (
      column_name = 'official_app_secret_ciphertext'
      AND column_type = 'varchar(1024)'
      AND is_nullable = 'YES'
    )
  );

SELECT
  index_name,
  non_unique,
  column_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_account'
  AND index_name = 'uk_qqbot_account_official_app_id';

SELECT
  'qqbot_official_app_id_unique_index' AS check_name,
  COUNT(*) AS matched_indexes
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_account'
  AND index_name = 'uk_qqbot_account_official_app_id'
  AND non_unique = 0
  AND seq_in_index = 1
  AND column_name = 'official_app_id';

SELECT
  connection_mode,
  COUNT(*) AS account_count
FROM qqbot_account
WHERE is_deleted = 0
GROUP BY connection_mode
ORDER BY connection_mode;

SELECT
  'qqbot_official_identity_mismatch' AS check_name,
  COUNT(*) AS invalid_rows
FROM qqbot_account
WHERE is_deleted = 0
  AND (
    (
      connection_mode IN ('official-websocket', 'official-webhook')
      AND (
        official_app_id IS NULL
        OR official_app_secret_ciphertext IS NULL
        OR self_id <> CONCAT('qq-official:', official_app_id)
      )
    )
    OR (
      connection_mode = 'reverse-ws'
      AND (
        official_app_id IS NOT NULL
        OR official_app_secret_ciphertext IS NOT NULL
      )
    )
  );

SELECT
  official_app_id,
  COUNT(*) AS duplicate_count
FROM qqbot_account
WHERE official_app_id IS NOT NULL
GROUP BY official_app_id
HAVING COUNT(*) > 1;
