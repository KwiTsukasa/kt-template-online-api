import { getMetadataArgsStorage } from 'typeorm';
import {
  QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
} from '../../../../src/modules/qqbot/plugin-platform/persistence';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

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

describe('QQBot plugin platform persistence contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares every plugin-platform table owned by Batch 5', () => {
    expect(QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables).toEqual([
      'qqbot_plugin',
      'qqbot_plugin_version',
      'qqbot_plugin_installation',
      'qqbot_plugin_operation',
      'qqbot_plugin_event_handler',
      'qqbot_plugin_account_binding',
      'qqbot_plugin_config',
      'qqbot_plugin_asset',
      'qqbot_plugin_runtime_event',
    ]);

    for (const table of QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }
  });

  it('maps plugin-platform entities to the v3 SQL schema', () => {
    expect(QQBOT_PLUGIN_PLATFORM_ENTITIES.map((entity) => entity.name)).toEqual(
      [
        'QqbotPlugin',
        'QqbotPluginVersion',
        'QqbotPluginInstallation',
        'QqbotPluginOperation',
        'QqbotPluginEventHandler',
        'QqbotPluginAccountBinding',
        'QqbotPluginConfig',
        'QqbotPluginAsset',
        'QqbotPluginRuntimeEvent',
      ],
    );

    for (const entity of QQBOT_PLUGIN_PLATFORM_ENTITIES) {
      const tableName = getEntityTableName(entity);
      const columns = getEntityColumnNames(entity);

      expect(tableName).toBeTruthy();
      expect(schema.hasTable(tableName || '')).toBe(true);
      schema.expectTableColumns(tableName || '', columns);
    }
  });
});
