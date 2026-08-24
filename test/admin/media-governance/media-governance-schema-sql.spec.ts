import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('media governance production schema SQL', () => {
  const initSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-init.sql'),
    'utf8',
  );
  const verifySql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-verify.sql'),
    'utf8',
  );
  const executorMigrationSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-executor-v1.sql'),
    'utf8',
  );
  const sourceMappingMigrationSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-source-mapping-v1.sql'),
    'utf8',
  );
  const seasonEpisodeStartMigrationSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-season-episode-start-v1.sql'),
    'utf8',
  );
  const seriesWorkMigrationSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-series-work-v1.sql'),
    'utf8',
  );
  const seriesWorkVerifySql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-series-work-v1-verify.sql'),
    'utf8',
  );
  const rssContextMigrationSql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-rss-context-v2.sql'),
    'utf8',
  );
  const rssContextVerifySql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-rss-context-v2-verify.sql'),
    'utf8',
  );

  it('creates exactly the nineteen task, Work catalog and RSS tables without menu writes', () => {
    const rssSubscriptionTable = initSql.match(
      /CREATE TABLE IF NOT EXISTS `media_governance_rss_subscription`[\s\S]+?ENGINE=InnoDB/iu,
    )?.[0];
    const episodeTable = initSql.match(
      /CREATE TABLE IF NOT EXISTS `media_governance_episode`[\s\S]+?ENGINE=InnoDB/iu,
    )?.[0];
    expect(initSql.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(19);
    expect(initSql).toContain('`media_governance_task`');
    expect(initSql).toContain('`media_governance_agent_session`');
    expect(initSql).toContain('`media_governance_outbox`');
    expect(initSql).toContain('`media_governance_series`');
    expect(initSql).toContain('`media_governance_work`');
    expect(initSql).toContain('`media_governance_work_external_ref`');
    expect(initSql).toContain('`media_governance_season`');
    expect(initSql).toContain('`primary_work_id` varchar(96) NOT NULL');
    expect(initSql).toContain('`canonical_namespace` varchar(16) NOT NULL');
    expect(initSql).toContain('`work_id` varchar(96) NOT NULL');
    expect(initSql).toContain('`media_governance_episode`');
    expect(initSql).toContain('`media_governance_task_episode_binding`');
    expect(initSql).toContain('`media_governance_rss_subscription`');
    expect(rssSubscriptionTable).toContain(
      '`identity_provider_id` varchar(64) NOT NULL',
    );
    expect(rssSubscriptionTable).toContain(
      'KEY `idx_media_governance_rss_identity` (`identity_provider`, `identity_provider_id`)',
    );
    expect(episodeTable).not.toContain('identity_provider');
    expect(initSql).toContain('`media_governance_rss_item`');
    expect(initSql).toContain('`episode_start` int NOT NULL DEFAULT 1');
    expect(initSql).not.toMatch(/admin_menu|admin_role_menu|INSERT\s+INTO/iu);
  });

  it('seals the restart and callback idempotency columns', () => {
    expect(initSql).toContain('`last_sequence` int NOT NULL DEFAULT 0');
    expect(initSql).toContain(
      'UNIQUE KEY `uk_media_governance_agent_task` (`task_id`)',
    );
    expect(initSql).toContain(
      'UNIQUE KEY `uk_media_governance_event_task_run_sequence` (`task_id`, `run_id`, `sequence`)',
    );
    expect(initSql).toContain('`progress_projection` longtext NOT NULL');
    expect(initSql).toContain('`llm_conversation_id` bigint DEFAULT NULL');
    expect(initSql).toContain(
      'UNIQUE KEY `uk_media_governance_task_llm_conversation` (`llm_conversation_id`)',
    );
    expect(initSql).toContain('`sealed_input` longtext NOT NULL');
    expect(initSql).toContain('`selected_file_indices` longtext DEFAULT NULL');
    expect(initSql).toContain('`selected_file_mappings` longtext DEFAULT NULL');
  });

  it('provides bounded post-migration verification without modifying rows', () => {
    expect(verifySql).toContain('COUNT(*) AS table_count');
    expect(verifySql).toContain('MAX(last_sequence)');
    expect(verifySql).toContain('llm_conversation_unique_index_count');
    expect(verifySql).toContain('canonical_identity_count');
    expect(verifySql).toContain('task_episode_identity_count');
    expect(verifySql).toContain('enabled_rss_subscription_count');
    expect(verifySql).toContain('season_episode_start_column_count');
    expect(verifySql).toContain('invalid_season_episode_range_count');
    expect(verifySql).not.toMatch(/INSERT|UPDATE|DELETE|ALTER|DROP/iu);
  });

  it('upgrades existing slice-three tables idempotently before deployment', () => {
    expect(executorMigrationSql).toContain("column_name = 'sealed_plan'");
    expect(executorMigrationSql).toContain("column_name = 'payload_seal'");
    expect(executorMigrationSql).toContain("column_name = 'sealed_input'");
    expect(executorMigrationSql).toContain('WHERE `sealed_input` IS NULL');
    expect(executorMigrationSql).toContain(
      "table_name = 'media_governance_descriptor_revision'",
    );
    expect(executorMigrationSql).toContain("is_nullable = 'NO'");
    expect(executorMigrationSql).toContain(
      'MODIFY COLUMN `manifest_sha256` varchar(64) NULL',
    );
    expect(executorMigrationSql).not.toMatch(/DROP\s+(?:TABLE|DATABASE)/iu);
  });

  it('verifies that pre-inspection magnet descriptors can persist a null manifest digest', () => {
    expect(verifySql).toContain(
      "table_name = 'media_governance_descriptor_revision'",
    );
    expect(verifySql).toContain("column_name = 'manifest_sha256'");
    expect(verifySql).toContain("is_nullable = 'YES'");
  });

  it('adds and verifies the explicit selected-file mapping projection idempotently', () => {
    expect(sourceMappingMigrationSql).toContain(
      "column_name = 'selected_file_mappings'",
    );
    expect(sourceMappingMigrationSql).toContain(
      'ADD COLUMN `selected_file_mappings` longtext NULL',
    );
    expect(sourceMappingMigrationSql).not.toMatch(
      /DROP\s+(?:TABLE|DATABASE)/iu,
    );
    expect(verifySql).toContain('COUNT(*) AS source_mapping_columns');
    expect(verifySql).toContain("column_name = 'selected_file_mappings'");
  });

  it('adds a non-null season episode start without rewriting existing task data', () => {
    expect(seasonEpisodeStartMigrationSql).toContain(
      "column_name = 'episode_start'",
    );
    expect(seasonEpisodeStartMigrationSql).toContain(
      'ADD COLUMN `episode_start` int NOT NULL DEFAULT 1',
    );
    expect(seasonEpisodeStartMigrationSql).not.toMatch(
      /DROP\s+(?:TABLE|DATABASE)|UPDATE\s+`media_governance_task`/iu,
    );
  });

  it('expands Series-first Work ownership and keeps movie membership explicit', () => {
    expect(seriesWorkMigrationSql).toContain(
      'CREATE TABLE IF NOT EXISTS `media_governance_work`',
    );
    expect(seriesWorkMigrationSql).toContain(
      'CREATE TABLE IF NOT EXISTS `media_governance_work_external_ref`',
    );
    expect(seriesWorkMigrationSql).toContain(
      "task.`operation_kind` = COALESCE(task.`operation_kind`, 'legacy-pipeline')",
    );
    expect(seriesWorkMigrationSql).toContain(
      "WHEN reference.`provider` = 'bangumi' THEN 'subject'",
    );
    expect(seriesWorkMigrationSql).toContain(
      '@legacy_reference_without_work_ref = 0',
    );
    expect(seriesWorkMigrationSql).not.toContain(
      'reference.`provider` = series.`canonical_provider`',
    );
    expect(seriesWorkMigrationSql).toContain(
      'ADD UNIQUE KEY `uk_media_governance_series_canonical` (`canonical_provider`, `canonical_namespace`, `canonical_provider_id`)',
    );
    expect(seriesWorkMigrationSql).toContain(
      "MESSAGE_TEXT = 'series-work backfill incomplete'",
    );
    expect(seriesWorkMigrationSql).not.toMatch(
      /UPDATE\s+`media_governance_task`[^;]+title_hint/iu,
    );
    expect(seriesWorkMigrationSql).not.toMatch(/咒术|810693|标题相似/iu);
    expect(verifySql).toContain('series_without_primary_work_count');
    expect(verifySql).toContain('invalid_series_namespace_count');
    expect(verifySql).toContain('season_work_mismatch_count');
    expect(verifySql).toContain('non_tv_work_with_season_count');
    expect(verifySql).toContain('task_work_series_mismatch_count');
    expect(verifySql).toContain(
      'legacy_series_reference_without_work_ref_count',
    );
    expect(seriesWorkVerifySql).toContain('schema_contract_mismatch_count');
    expect(seriesWorkVerifySql).toContain(
      'legacy_series_reference_without_work_ref_count',
    );
    expect(seriesWorkVerifySql).not.toMatch(
      /INSERT|UPDATE|DELETE|ALTER|DROP/iu,
    );
  });

  it('persists the verified RSS identity and verifies its Work ownership', () => {
    expect(rssContextMigrationSql).toContain(
      'ADD COLUMN `identity_provider_id` varchar(64) NULL',
    );
    expect(rssContextMigrationSql).toContain(
      'subscription.`identity_provider_id` = work.`canonical_provider_id`',
    );
    expect(rssContextMigrationSql).not.toMatch(/DROP\s+(?:TABLE|DATABASE)/iu);
    expect(rssContextVerifySql).toContain('rss_context_missing_identity_count');
    expect(rssContextVerifySql).toContain(
      'rss_context_work_ref_mismatch_count',
    );
    expect(rssContextVerifySql).not.toMatch(
      /INSERT|UPDATE|DELETE|ALTER|DROP/iu,
    );
  });
});
