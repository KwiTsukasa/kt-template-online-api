-- 允许一季保留资料库的连续集号起点。执行前备份 catalog 七表；重复执行必须无副作用。
SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_governance_season'
      AND column_name = 'episode_start'
  ),
  'SELECT 1',
  'ALTER TABLE `media_governance_season` ADD COLUMN `episode_start` int NOT NULL DEFAULT 1 AFTER `season_number`'
);
PREPARE statement FROM @ddl;
EXECUTE statement;
DEALLOCATE PREPARE statement;
