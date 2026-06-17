import { getMetadataArgsStorage } from 'typeorm';
import {
  QQBOT_PLUGIN_PLATFORM_DOMAIN_CONTRACT,
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/persistence';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

/**
 * 查询 QQBot 插件平台数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 插件平台步骤。
 */
const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

/**
 * 查询 QQBot 插件平台数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 插件平台步骤。
 */
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
      'qqbot_plugin_task',
      'qqbot_plugin_task_run',
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
        'QqbotPluginTask',
        'QqbotPluginTaskRun',
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
