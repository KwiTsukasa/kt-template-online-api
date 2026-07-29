SET @admin_password_hash_pattern =
  '^[$]pbkdf2-sha256[$]v=1[$]i=600000[$][A-Za-z0-9_-]{42}[AEIMQUYcgkosw048][$][A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$';

SELECT
  COUNT(*) AS total_count,
  COALESCE(
    SUM(
      CASE
        WHEN password REGEXP BINARY @admin_password_hash_pattern THEN 1
        ELSE 0
      END
    ),
    0
  ) AS versioned_count,
  COALESCE(
    SUM(
      CASE
        WHEN password REGEXP BINARY @admin_password_hash_pattern THEN 0
        ELSE 1
      END
    ),
    0
  ) AS invalid_count
FROM admin_user;

SELECT
  CAST(id AS CHAR) AS id,
  'invalid_password_hash' AS status
FROM admin_user
WHERE NOT (password REGEXP BINARY @admin_password_hash_pattern)
ORDER BY id;
