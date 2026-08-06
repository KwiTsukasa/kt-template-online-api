-- Existing environments must apply this before deploying profile upserts.
-- The migration changes indexes only and fails closed when duplicate bindings exist.

DROP PROCEDURE IF EXISTS `kt_enforce_napcat_profile_container_unique`;

DELIMITER $$

CREATE PROCEDURE `kt_enforce_napcat_profile_container_unique`()
BEGIN
  DECLARE runtime_duplicate_groups BIGINT DEFAULT 0;
  DECLARE protocol_duplicate_groups BIGINT DEFAULT 0;
  DECLARE runtime_old_index INT DEFAULT 0;
  DECLARE runtime_unique_index INT DEFAULT 0;
  DECLARE protocol_old_index INT DEFAULT 0;
  DECLARE protocol_unique_index INT DEFAULT 0;

  SELECT COUNT(*) INTO runtime_duplicate_groups
  FROM (
    SELECT container_id
    FROM napcat_runtime_profile
    WHERE container_id IS NOT NULL
    GROUP BY container_id
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  SELECT COUNT(*) INTO protocol_duplicate_groups
  FROM (
    SELECT container_id
    FROM napcat_protocol_profile
    WHERE container_id IS NOT NULL
    GROUP BY container_id
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  IF runtime_duplicate_groups > 0 OR protocol_duplicate_groups > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'NapCat profile container duplicates must be resolved before adding unique indexes';
  END IF;

  SELECT COUNT(*) INTO runtime_old_index
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'napcat_runtime_profile'
    AND index_name = 'idx_napcat_runtime_profile_container';

  SELECT COUNT(*) INTO runtime_unique_index
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'napcat_runtime_profile'
    AND index_name = 'uk_napcat_runtime_profile_container'
    AND non_unique = 0;

  IF runtime_unique_index = 0 THEN
    IF runtime_old_index > 0 THEN
      ALTER TABLE napcat_runtime_profile
        DROP INDEX idx_napcat_runtime_profile_container,
        ADD UNIQUE KEY uk_napcat_runtime_profile_container (container_id);
    ELSE
      ALTER TABLE napcat_runtime_profile
        ADD UNIQUE KEY uk_napcat_runtime_profile_container (container_id);
    END IF;
  ELSEIF runtime_old_index > 0 THEN
    ALTER TABLE napcat_runtime_profile
      DROP INDEX idx_napcat_runtime_profile_container;
  END IF;

  SELECT COUNT(*) INTO protocol_old_index
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'napcat_protocol_profile'
    AND index_name = 'idx_napcat_protocol_profile_container';

  SELECT COUNT(*) INTO protocol_unique_index
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'napcat_protocol_profile'
    AND index_name = 'uk_napcat_protocol_profile_container'
    AND non_unique = 0;

  IF protocol_unique_index = 0 THEN
    IF protocol_old_index > 0 THEN
      ALTER TABLE napcat_protocol_profile
        DROP INDEX idx_napcat_protocol_profile_container,
        ADD UNIQUE KEY uk_napcat_protocol_profile_container (container_id);
    ELSE
      ALTER TABLE napcat_protocol_profile
        ADD UNIQUE KEY uk_napcat_protocol_profile_container (container_id);
    END IF;
  ELSEIF protocol_old_index > 0 THEN
    ALTER TABLE napcat_protocol_profile
      DROP INDEX idx_napcat_protocol_profile_container;
  END IF;
END$$

DELIMITER ;

CALL `kt_enforce_napcat_profile_container_unique`();
DROP PROCEDURE `kt_enforce_napcat_profile_container_unique`;
