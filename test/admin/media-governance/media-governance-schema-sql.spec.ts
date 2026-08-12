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

  it('creates exactly the ten designed domain tables without menu writes', () => {
    expect(initSql.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(10);
    expect(initSql).toContain('`media_governance_task`');
    expect(initSql).toContain('`media_governance_agent_session`');
    expect(initSql).toContain('`media_governance_outbox`');
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
    expect(initSql).toContain('`sealed_input` longtext NOT NULL');
  });

  it('provides bounded post-migration verification without modifying rows', () => {
    expect(verifySql).toContain('COUNT(*) AS table_count');
    expect(verifySql).toContain('MAX(last_sequence)');
    expect(verifySql).not.toMatch(/INSERT|UPDATE|DELETE|ALTER|DROP/iu);
  });

  it('upgrades existing slice-three tables idempotently before deployment', () => {
    expect(executorMigrationSql).toContain("column_name = 'sealed_plan'");
    expect(executorMigrationSql).toContain("column_name = 'payload_seal'");
    expect(executorMigrationSql).toContain("column_name = 'sealed_input'");
    expect(executorMigrationSql).toContain('WHERE `sealed_input` IS NULL');
    expect(executorMigrationSql).not.toMatch(/DROP\s+(?:TABLE|DATABASE)/iu);
  });
});
