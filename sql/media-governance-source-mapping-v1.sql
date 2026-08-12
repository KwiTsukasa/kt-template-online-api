-- 媒体来源文件到治理单元的显式映射。执行前备份 kt_template；重复执行必须无副作用。
SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_source'
      AND column_name = 'selected_file_mappings'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_source` ADD COLUMN `selected_file_mappings` longtext NULL AFTER `selected_file_indices`'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
