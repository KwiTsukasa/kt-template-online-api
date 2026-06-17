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

/**
 * 查询 QQBot 核心数据。
 * @param moduleClass - Nest 模块类；读取装饰器 metadata。
 * @param key - 键名；读取装饰器 metadata。
 * @returns QQBot 核心查询结果。
 */
const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

/**
 * 查询 QQBot 核心数据。
 * @param items - QQBot列表；转换 QQBot列表项。
 */
const getNames = (items: unknown[]) =>
  items.map((item) => (item as { name?: string }).name || `${item}`);

type EntityClass = new (...args: never[]) => unknown;

/**
 * 查询 QQBot 核心数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 QQBot步骤。
 */
const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

/**
 * 查询 QQBot 核心数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 QQBot步骤。
 */
const getEntityColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);
};

/**
 * 查询 QQBot 核心数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 QQBot步骤。
 */
const getEntityNullableColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .filter((column) => column.options.nullable === true)
    .map((column) => `${column.options.name || column.propertyName}`);
};

/**
 * 判断 QQBot 核心条件。
 * @param definition - definition 输入；计算 QQBot判断结果。
 */
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
    expect(routes.map(routeKey)).not.toEqual(
      expect.arrayContaining([
        'POST /qqbot/account/scan/create',
        'POST /qqbot/account/scan/refresh',
        'GET /qqbot/account/scan/status',
        'GET /qqbot/account/scan/events',
        'POST /qqbot/account/scan/qrcode/refresh',
        'POST /qqbot/account/scan/captcha/submit',
        'POST /qqbot/account/scan/cancel',
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

    expect(appImports).toEqual(expect.arrayContaining([QqbotCoreModule]));
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
        'QqbotPermissionService',
        'QqbotRateLimitService',
        'QqbotReplyTemplateService',
        'QqbotReverseWsService',
        'QqbotRuleEngineService',
        'QqbotRuleService',
        'QqbotSendService',
      ]),
    );
    expect(getNames(QQBOT_CORE_PROVIDERS)).not.toEqual(
      expect.arrayContaining([
        'NapcatDeviceIdentityService',
        'NapcatLoginStateStoreService',
        'QqbotNapcatContainerService',
        'QqbotNapcatLoginService',
        'QqbotNapcatWatchdogService',
      ]),
    );
    expect(getNames(QQBOT_CORE_ENTITIES)).toEqual(
      expect.arrayContaining([
        'QqbotAccount',
        'QqbotAccountAbility',
        'QqbotAllowlist',
        'QqbotBlocklist',
        'QqbotCommand',
        'QqbotCommandLog',
        'QqbotConfig',
        'QqbotConversation',
        'QqbotDedupe',
        'QqbotMessage',
        'QqbotRule',
        'QqbotSendLog',
      ]),
    );
    expect(getNames(QQBOT_CORE_ENTITIES)).not.toEqual(
      expect.arrayContaining([
        'NapcatAccountBinding',
        'NapcatContainer',
        'NapcatDeviceIdentity',
        'NapcatLoginChallengeEntity',
        'NapcatLoginSession',
        'NapcatRuntimeCleanup',
        'QqbotAccountNapcat',
        'QqbotNapcatContainer',
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
