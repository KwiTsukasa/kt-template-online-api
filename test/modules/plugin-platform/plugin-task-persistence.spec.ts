import { getMetadataArgsStorage } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  PLUGIN_PLATFORM_ENTITIES,
  PluginTask,
  PluginTaskRun,
} from '../../../src/modules/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

describe('plugin task persistence contract', () => {
  const schema = readRefactorV3SqlSchema();
  const repoRoot = join(__dirname, '../../..');

  it('declares task tables in SQL and entity registry', () => {
    expect(PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining(['plugin_task', 'plugin_task_run']),
    );
    expect(PLUGIN_PLATFORM_ENTITIES).toEqual(
      expect.arrayContaining([PluginTask, PluginTaskRun]),
    );
    expect(schema.hasTable('plugin_task')).toBe(true);
    expect(schema.hasTable('plugin_task_run')).toBe(true);
  });

  it('maps task entity columns to SQL schema', () => {
    for (const entity of [PluginTask, PluginTaskRun]) {
      const tableName = getMetadataArgsStorage().tables.find(
        (table) => table.target === entity,
      )?.name;
      const columns = getMetadataArgsStorage()
        .columns.filter((column) => column.target === entity)
        .map((column) => `${column.options.name || column.propertyName}`);

      expect(tableName).toBeTruthy();
      schema.expectTableColumns(tableName || '', columns);
    }
  });

  it('keeps bot-init able to incrementally create plugin task tables online', () => {
    const sql = readFileSync(join(repoRoot, 'sql/bot-init.sql'), 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `plugin_task`');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `plugin_task_run`');
    expect(sql).toContain('uk_plugin_task');
    expect(sql).toContain('idx_plugin_task_run_task_time');
  });
});
