import { getMetadataArgsStorage } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
  QqbotPluginTask,
  QqbotPluginTaskRun,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot plugin task persistence contract', () => {
  const schema = readRefactorV3SqlSchema();
  const repoRoot = join(__dirname, '../../../..');

  it('declares task tables in SQL and entity registry', () => {
    expect(QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining(['qqbot_plugin_task', 'qqbot_plugin_task_run']),
    );
    expect(QQBOT_PLUGIN_PLATFORM_ENTITIES).toEqual(
      expect.arrayContaining([QqbotPluginTask, QqbotPluginTaskRun]),
    );
    expect(schema.hasTable('qqbot_plugin_task')).toBe(true);
    expect(schema.hasTable('qqbot_plugin_task_run')).toBe(true);
  });

  it('maps task entity columns to SQL schema', () => {
    for (const entity of [QqbotPluginTask, QqbotPluginTaskRun]) {
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

  it('keeps qqbot-init able to incrementally create plugin task tables online', () => {
    const sql = readFileSync(join(repoRoot, 'sql/qqbot-init.sql'), 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `qqbot_plugin_task`');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `qqbot_plugin_task_run`');
    expect(sql).toContain('uk_qqbot_plugin_task');
    expect(sql).toContain('idx_qqbot_plugin_task_run_task_time');
  });
});
