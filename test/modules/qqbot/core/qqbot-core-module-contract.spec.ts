jest.mock(
  '@/modules/qqbot/plugins/bangDream/application/bangdream-client.service',
  () => ({
    QqbotBangDreamClientService: class QqbotBangDreamClientService {},
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade',
  () => ({
    QqbotBangDreamRendererService: class QqbotBangDreamRendererService {},
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service',
  () => ({
    TsuguApplicationService: class TsuguApplicationService {},
  }),
);
jest.mock('@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin', () => ({
  QqbotBangDreamPluginService: class QqbotBangDreamPluginService {},
}));
jest.mock(
  '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-client.service',
  () => ({
    QqbotFf14ClientService: class QqbotFf14ClientService {},
  }),
);
jest.mock(
  '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin',
  () => ({
    QqbotFf14MarketPluginService: class QqbotFf14MarketPluginService {},
  }),
);
jest.mock('@/modules/qqbot/plugins/fflogs/qqbot-fflogs-client.service', () => ({
  QqbotFflogsClientService: class QqbotFflogsClientService {},
}));
jest.mock('@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin', () => ({
  QqbotFflogsPluginService: class QqbotFflogsPluginService {},
}));
jest.mock('@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin', () => ({
  QqbotRepeaterPluginService: class QqbotRepeaterPluginService {},
}));

import { existsSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { AdminAuthGuardModule } from '../../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { DictModule } from '../../../../src/modules/admin/platform-config/dict/dict.module';
import { AppModule } from '../../../../src/app.module';
import { QqbotAccountController } from '../../../../src/modules/qqbot/core/contract/account/qqbot-account.controller';
import { QqbotCommandController } from '../../../../src/modules/qqbot/core/contract/command/qqbot-command.controller';
import { QqbotDashboardController } from '../../../../src/modules/qqbot/core/contract/dashboard/qqbot-dashboard.controller';
import { QqbotMessageController } from '../../../../src/modules/qqbot/core/contract/message/qqbot-message.controller';
import { QqbotPermissionController } from '../../../../src/modules/qqbot/core/contract/permission/qqbot-permission.controller';
import { QqbotRuleController } from '../../../../src/modules/qqbot/core/contract/rule/qqbot-rule.controller';
import { QqbotSendController } from '../../../../src/modules/qqbot/core/contract/send/qqbot-send.controller';
import {
  QQBOT_CORE_CONTROLLERS,
  QQBOT_CORE_ENTITIES,
  QQBOT_CORE_EXPORTS,
  QQBOT_CORE_PROVIDERS,
  QqbotCoreModule,
} from '../../../../src/modules/qqbot/core/qqbot-core.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

const getNames = (items: unknown[]) =>
  items.map((item) => (item as { name?: string }).name || `${item}`);

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

const getEntityNullableColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .filter((column) => column.options.nullable === true)
    .map((column) => `${column.options.name || column.propertyName}`);
};

const isOptionalSqlColumnForEntityInsert = (definition: string) => {
  return (
    !/\bNOT\s+NULL\b/i.test(definition) ||
    /\bDEFAULT\b/i.test(definition) ||
    /\bAUTO_INCREMENT\b/i.test(definition)
  );
};

describe('QQBot core module contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps QQBot Admin and runtime routes compatible through the core boundary', () => {
    const routes = collectControllerRoutes(QQBOT_CORE_CONTROLLERS);

    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'GET /qqbot/account/list',
        'GET /qqbot/account/enabled',
        'POST /qqbot/account/scan/create',
        'GET /qqbot/account/scan/status',
        'POST /qqbot/account/bind/command',
        'POST /qqbot/account/unbind/command',
        'POST /qqbot/account/kick',
        'GET /qqbot/command/list',
        'POST /qqbot/command/test',
        'GET /qqbot/conversation/list',
        'GET /qqbot/message/list',
        'GET /qqbot/permission/config',
        'GET /qqbot/permission/allowlist',
        'GET /qqbot/permission/blocklist',
        'GET /qqbot/rule/list',
        'GET /qqbot/send/log/list',
        'POST /qqbot/send/private',
        'POST /qqbot/send/group',
        'GET /qqbot/dashboard/summary',
      ]),
    );
  });

  it('routes QQBot through the core module as the owning Nest boundary', () => {
    const legacyWrapperName = ['Qqbot', 'Module'].join('');
    const legacyWrapperPath = join(
      process.cwd(),
      'src',
      'qqbot',
      ['qqbot', 'module.ts'].join('.'),
    );
    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);

    expect(appImports).toEqual(
      expect.arrayContaining([QqbotCoreModule]),
    );
    expect(getNames(appImports)).not.toContain(legacyWrapperName);
    expect(existsSync(legacyWrapperPath)).toBe(false);

    const coreImports = getModuleMetadata(
      QqbotCoreModule,
      MODULE_METADATA.IMPORTS,
    );
    expect(coreImports).toEqual(
      expect.arrayContaining([ConfigModule, AdminAuthGuardModule, DictModule]),
    );
    expect(
      coreImports.some(
        (item) => (item as { module?: unknown }).module === TypeOrmModule,
      ),
    ).toBe(true);
    expect(getNames(coreImports)).not.toContain(legacyWrapperName);

    expect(
      getModuleMetadata(QqbotCoreModule, MODULE_METADATA.CONTROLLERS),
    ).toEqual(expect.arrayContaining(QQBOT_CORE_CONTROLLERS));
    expect(
      getModuleMetadata(QqbotCoreModule, MODULE_METADATA.PROVIDERS),
    ).toEqual(expect.arrayContaining(QQBOT_CORE_PROVIDERS));
    expect(getModuleMetadata(QqbotCoreModule, MODULE_METADATA.EXPORTS)).toEqual(
      expect.arrayContaining(QQBOT_CORE_EXPORTS),
    );
  });

  it('makes the legacy QQBot controllers, providers and entities explicit', () => {
    expect(QQBOT_CORE_CONTROLLERS).toEqual(
      expect.arrayContaining([
        QqbotAccountController,
        QqbotCommandController,
        QqbotDashboardController,
        QqbotMessageController,
        QqbotPermissionController,
        QqbotRuleController,
        QqbotSendController,
      ]),
    );
    expect(getNames(QQBOT_CORE_PROVIDERS)).toEqual(
      expect.arrayContaining([
        'QqbotAccountService',
        'QqbotBusService',
        'QqbotCommandEngineService',
        'QqbotCommandParserService',
        'QqbotCommandService',
        'QqbotConfigService',
        'QqbotDashboardService',
        'QqbotDedupeService',
        'QqbotEventService',
        'QqbotMessageService',
        'NapcatDeviceIdentityService',
        'QqbotNapcatContainerService',
        'QqbotNapcatLoginService',
        'QqbotNapcatWatchdogService',
        'QqbotPermissionService',
        'QqbotRateLimitService',
        'QqbotReplyTemplateService',
        'QqbotReverseWsService',
        'QqbotRuleEngineService',
        'QqbotRuleService',
        'QqbotSendService',
      ]),
    );
    expect(getNames(QQBOT_CORE_ENTITIES)).toEqual(
      expect.arrayContaining([
        'QqbotAccount',
        'QqbotAccountAbility',
        'QqbotAccountNapcat',
        'QqbotAllowlist',
        'QqbotBlocklist',
        'NapcatDeviceIdentity',
        'QqbotCommand',
        'QqbotCommandLog',
        'QqbotConfig',
        'QqbotConversation',
        'QqbotDedupe',
        'QqbotMessage',
        'QqbotNapcatContainer',
        'QqbotRule',
        'QqbotSendLog',
      ]),
    );
  });

  it('keeps every registered QQBot core entity mapped to the refactor-v3 schema', () => {
    for (const entity of QQBOT_CORE_ENTITIES) {
      const tableName = getEntityTableName(entity);
      const columns = getEntityColumnNames(entity);
      const nullableColumns = getEntityNullableColumnNames(entity);

      expect(tableName).toBeTruthy();
      expect(schema.hasTable(tableName || '')).toBe(true);
      schema.expectTableColumns(tableName || '', columns);

      const sqlColumns = schema.getTableColumns(tableName || '');
      const entityColumnNames = new Set(columns);
      const requiredSqlOnlyColumns = sqlColumns
        .filter((column) => !entityColumnNames.has(column.name))
        .filter(
          (column) => !isOptionalSqlColumnForEntityInsert(column.definition),
        )
        .map((column) => `${tableName}.${column.name}`);

      expect(requiredSqlOnlyColumns).toEqual([]);

      for (const nullableColumn of nullableColumns) {
        const sqlColumn = sqlColumns.find(
          (column) => column.name === nullableColumn,
        );
        expect(sqlColumn?.definition).not.toMatch(/\bNOT\s+NULL\b/i);
      }
    }
  });
});
