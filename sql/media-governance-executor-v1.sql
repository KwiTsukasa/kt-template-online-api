-- 媒体治理执行器增量结构。执行前备份 kt_template 数据库；重复执行必须无副作用。
SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'sealed_plan'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_task` ADD COLUMN `sealed_plan` longtext NULL AFTER `sealed_plan_sha256`'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_task'
      AND column_name = 'payload_seal'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_task` ADD COLUMN `payload_seal` longtext NULL AFTER `sealed_plan`'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_outbox'
      AND column_name = 'sealed_input'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_outbox` ADD COLUMN `sealed_input` longtext NULL AFTER `sealed_input_sha256`'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;

UPDATE `media_governance_outbox`
SET `attempts` = 5
WHERE `sealed_input` IS NULL
  AND `execution_id` IS NULL;

UPDATE `media_governance_outbox`
SET `sealed_input` = '{}'
WHERE `sealed_input` IS NULL;

ALTER TABLE `media_governance_outbox`
  MODIFY COLUMN `sealed_input` longtext NOT NULL;
