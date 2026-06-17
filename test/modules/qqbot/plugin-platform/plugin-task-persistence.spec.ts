import { getMetadataArgsStorage } from 'typeorm';
import {
  QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
  QqbotPluginTask,
  QqbotPluginTaskRun,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot plugin task persistence contract', () => {
  const schema = readRefactorV3SqlSchema();

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
});
