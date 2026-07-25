import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { AdminAuthGuardModule } from '../../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { DictModule } from '../../../../src/modules/admin/platform-config/dict/dict.module';
import { AppModule } from '../../../../src/app.module';
import { QqbotAccountController } from '../../../../src/modules/qqbot/core/contract/account/qqbot-account.controller';
import { QqbotCommandController } from '../../../../src/modules/qqbot/core/contract/command/qqbot-command.controller';
import { QqbotDashboardController } from '../../../../src/modules/qqbot/core/contract/dashboard/qqbot-dashboard.controller';
import { QqbotMessageController } from '../../../../src/modules/qqbot/core/contract/message/qqbot-message.controller';
import { QqbotPermissionController } from '../../../../src/modules/qqbot/core/contract/permission/qqbot-permission.controller';
import { QqbotRuleController } from '../../../../src/modules/qqbot/core/contract/rule/qqbot-rule.controller';
import { QqbotSendController } from '../../../../src/modules/qqbot/core/contract/send/qqbot-send.controller';
import { QqbotAccountMessagePushController } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-account-message-push.controller';
import { QqbotMessagePushController } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.controller';
import { QqbotMessagePushPermissionGuard } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-permission.guard';
import { SystemMessageEventStagerService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-event-stager.service';
import { SystemMessageFanoutService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-fanout.service';
import { SystemMessageDeliveryCoordinatorService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-delivery-coordinator.service';
import { SystemMessageDeliveryRunnerService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-delivery-runner.service';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SYSTEM_MESSAGE_EVENT_STAGER,
} from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
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

  it('registers the strict message-push HTTP boundary without internal worker routes', () => {
    const messagePushRoutes = collectControllerRoutes([
      QqbotMessagePushController,
      QqbotAccountMessagePushController,
    ]).map(routeKey);

    expect(messagePushRoutes).toEqual(
      [
        'DELETE /qqbot/accounts/:selfId/message-push/bindings/:id',
        'DELETE /qqbot/message-push/subscriptions/:id',
        'DELETE /qqbot/message-push/templates/:id',
        'GET /qqbot/accounts/:selfId/message-push/bindings',
        'GET /qqbot/accounts/:selfId/message-push/targets',
        'GET /qqbot/message-push/sources',
        'GET /qqbot/message-push/sources/:sourceKey',
        'GET /qqbot/message-push/sources/network.stun.mapping-port-changed/options',
        'GET /qqbot/message-push/subscriptions',
        'GET /qqbot/message-push/templates',
        'POST /qqbot/accounts/:selfId/message-push/bindings',
        'POST /qqbot/message-push/subscriptions',
        'POST /qqbot/message-push/templates',
        'POST /qqbot/message-push/templates/preview',
        'PUT /qqbot/accounts/:selfId/message-push/bindings/:id',
        'PUT /qqbot/accounts/:selfId/message-push/bindings/:id/enabled',
        'PUT /qqbot/message-push/subscriptions/:id',
        'PUT /qqbot/message-push/subscriptions/:id/enabled',
        'PUT /qqbot/message-push/templates/:id',
        'PUT /qqbot/message-push/templates/:id/enabled',
      ].sort(),
    );
    expect(messagePushRoutes.join('\n')).not.toMatch(
      /\/(?:publish|events|deliveries|fanout|retry)(?:\/|$)/,
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
    expect(QQBOT_CORE_PROVIDERS).toEqual(
      expect.arrayContaining([
        SystemMessageEventStagerService,
        SystemMessageFanoutService,
        SystemMessageDeliveryRunnerService,
        SystemMessageDeliveryCoordinatorService,
        {
          provide: SYSTEM_MESSAGE_EVENT_STAGER,
          useExisting: SystemMessageEventStagerService,
        },
        {
          provide: SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
          useExisting: SystemMessageDeliveryCoordinatorService,
        },
      ]),
    );
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) => provider === SystemMessageFanoutService,
      ),
    ).toHaveLength(1);
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          provider.provide === SYSTEM_MESSAGE_EVENT_STAGER,
      ),
    ).toEqual([
      {
        provide: SYSTEM_MESSAGE_EVENT_STAGER,
        useExisting: SystemMessageEventStagerService,
      },
    ]);
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) => provider === QqbotMessagePushPermissionGuard,
      ),
    ).toHaveLength(1);
    expect(new Set(QQBOT_CORE_CONTROLLERS).size).toBe(
      QQBOT_CORE_CONTROLLERS.length,
    );
    expect(new Set(QQBOT_CORE_PROVIDERS).size).toBe(
      QQBOT_CORE_PROVIDERS.length,
    );
    expect(QQBOT_CORE_PROVIDERS).not.toContain(JwtAuthGuard);
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) => provider === SystemMessageDeliveryRunnerService,
      ),
    ).toHaveLength(1);
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) => provider === SystemMessageDeliveryCoordinatorService,
      ),
    ).toHaveLength(1);
    expect(QQBOT_CORE_EXPORTS).toEqual(
      expect.arrayContaining([
        SYSTEM_MESSAGE_EVENT_STAGER,
        SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
      ]),
    );
    expect(QQBOT_CORE_EXPORTS).not.toContain(
      SystemMessageDeliveryCoordinatorService,
    );
    expect(
      QQBOT_CORE_PROVIDERS.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          provider.provide === SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
      ),
    ).toEqual([
      {
        provide: SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
        useExisting: SystemMessageDeliveryCoordinatorService,
      },
    ]);
    const coreModuleSource = readFileSync(
      join(process.cwd(), 'src/modules/qqbot/core/qqbot-core.module.ts'),
      'utf8',
    );
    expect(coreModuleSource).not.toMatch(
      /network-(?:agent-mqtt|ddns|stun-message-source)/,
    );
  });

  it('makes the legacy QQBot controllers, providers and entities explicit', () => {
    expect(QQBOT_CORE_CONTROLLERS).toEqual(
      expect.arrayContaining([
        QqbotAccountController,
        QqbotAccountMessagePushController,
        QqbotCommandController,
        QqbotDashboardController,
        QqbotMessageController,
        QqbotMessagePushController,
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
        'QqbotMessageSubscription',
        'QqbotMessageTemplate',
        'QqbotMessagePublishBinding',
        'QqbotMessagePublishTarget',
        'QqbotMessageEvent',
        'QqbotMessageDelivery',
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
