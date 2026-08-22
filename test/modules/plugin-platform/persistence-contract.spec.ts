import { getMetadataArgsStorage } from 'typeorm';
import {
  PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  PLUGIN_PLATFORM_ENTITIES,
} from '../../../src/modules/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

const getEntityColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);
};

describe('plugin platform persistence contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares every plugin-platform table owned by Batch 5', () => {
    expect(PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables).toEqual([
      'plugin',
      'plugin_version',
      'plugin_installation',
      'plugin_operation',
      'plugin_event_handler',
      'plugin_config',
      'plugin_asset',
      'plugin_runtime_event',
      'plugin_task',
      'plugin_task_run',
    ]);

    for (const table of PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }
  });

  it('maps plugin-platform entities to the v3 SQL schema', () => {
    expect(PLUGIN_PLATFORM_ENTITIES.map((entity) => entity.name)).toEqual([
      'Plugin',
      'PluginVersion',
      'PluginInstallation',
      'PluginOperation',
      'PluginEventHandler',
      'PluginConfig',
      'PluginAsset',
      'PluginRuntimeEvent',
      'PluginTask',
      'PluginTaskRun',
    ]);

    for (const entity of PLUGIN_PLATFORM_ENTITIES) {
      const tableName = getEntityTableName(entity);
      const columns = getEntityColumnNames(entity);

      expect(tableName).toBeTruthy();
      expect(schema.hasTable(tableName || '')).toBe(true);
      schema.expectTableColumns(tableName || '', columns);
    }
  });
});
