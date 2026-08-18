import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { getMetadataArgsStorage } from 'typeorm';
import { AppModule } from '../../../../src/app.module';
import { AdminAuthGuardModule } from '../../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { NoticeModule } from '../../../../src/modules/admin/platform-config/notice/notice.module';
import { StationNoticeMessageBindingController } from '../../../../src/modules/admin/platform-config/notice/station-notice-message-binding.controller';
import { StationNoticeMessageBinding } from '../../../../src/modules/admin/platform-config/notice/station-notice-message-binding.entity';
import { StationNoticeMessageSubscriberAdapter } from '../../../../src/modules/admin/platform-config/notice/station-notice-message-subscriber.adapter';
import { MessageSubscriberRegistry } from '../../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { SystemMessageDeliveryCoordinatorService } from '../../../../src/modules/message-management/application/system-message-delivery-coordinator.service';
import { SystemMessageEventStagerService } from '../../../../src/modules/message-management/application/system-message-event-stager.service';
import { SystemMessageFanoutService } from '../../../../src/modules/message-management/application/system-message-fanout.service';
import { MessageManagementController } from '../../../../src/modules/message-management/contract/message-management.controller';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  SYSTEM_MESSAGE_EVENT_STAGER,
} from '../../../../src/modules/message-management/contract/message-management.types';
import {
  MESSAGE_MANAGEMENT_CONTROLLERS,
  MESSAGE_MANAGEMENT_ENTITIES,
  MESSAGE_MANAGEMENT_EXPORTS,
  MESSAGE_MANAGEMENT_PROVIDERS,
  MessageManagementModule,
} from '../../../../src/modules/message-management/message-management.module';
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
import { QqbotAccountMessagePushController } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-account-message-push.controller';
import { QqbotMessageSubscriberAdapter } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-subscriber.adapter';
import {
  QQBOT_MESSAGE_SUBSCRIBER_ENTITIES,
  QqbotMessageSubscriberModule,
} from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-subscriber.module';
import { SystemMessageDeliveryRunnerService } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-delivery-runner.service';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] =>
  Reflect.getMetadata(key, moduleClass) || [];

const getNames = (items: unknown[]) =>
  items.map((item) => (item as { name?: string }).name || `${item}`);

type EntityClass = new (...args: never[]) => unknown;

const getEntityTableName = (entity: EntityClass) =>
  getMetadataArgsStorage().tables.find((table) => table.target === entity)
    ?.name;

const getEntityColumnNames = (entity: EntityClass) =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);

const getEntityNullableColumnNames = (entity: EntityClass) =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .filter((column) => column.options.nullable === true)
    .map((column) => `${column.options.name || column.propertyName}`);

const isOptionalSqlColumnForEntityInsert = (definition: string) =>
  !/\bNOT\s+NULL\b/i.test(definition) ||
  /\bDEFAULT\b/i.test(definition) ||
  /\bAUTO_INCREMENT\b/i.test(definition);

describe('QQBot and message-management module contracts', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps ordinary QQBot routes in QQBot core without message-management routes', () => {
    const routes = collectControllerRoutes(QQBOT_CORE_CONTROLLERS).map(
      routeKey,
    );

    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /qqbot/account/list',
        'GET /qqbot/command/list',
        'POST /qqbot/command/test',
        'GET /qqbot/message/list',
        'GET /qqbot/permission/config',
        'GET /qqbot/rule/list',
        'POST /qqbot/send/private',
        'POST /qqbot/send/group',
        'GET /qqbot/dashboard/summary',
      ]),
    );
    expect(routes.join('\n')).not.toMatch(/message-(?:management|push)/);
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
  });

  it('publishes generic management routes separately from concrete subscriber routes', () => {
    const routes = collectControllerRoutes([
      MessageManagementController,
      QqbotAccountMessagePushController,
      StationNoticeMessageBindingController,
    ]).map(routeKey);

    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /message-management/subscribers',
        'GET /message-management/sources',
        'GET /message-management/subscriptions',
        'POST /message-management/subscriptions',
        'GET /message-management/templates',
        'POST /message-management/templates',
        'POST /message-management/templates/preview',
        'GET /message-management/subscribers/qqbot/accounts/:selfId/bindings',
        'POST /message-management/subscribers/qqbot/accounts/:selfId/bindings',
        'GET /message-management/subscribers/station-notice/bindings',
        'POST /message-management/subscribers/station-notice/bindings',
      ]),
    );
    expect(routes.join('\n')).not.toMatch(
      /\/(?:publish|events|deliveries|fanout|retry)(?:\/|$)/,
    );
  });

  it('places the protocol kernel, QQBot subscriber, and station subscriber in their owning modules', () => {
    const appImports = getModuleMetadata<unknown>(
      AppModule,
      MODULE_METADATA.IMPORTS,
    );
    expect(appImports).toEqual(
      expect.arrayContaining([
        MessageManagementModule,
        QqbotCoreModule,
        QqbotMessageSubscriberModule,
      ]),
    );

    expect(MESSAGE_MANAGEMENT_CONTROLLERS).toEqual([
      MessageManagementController,
    ]);
    expect(MESSAGE_MANAGEMENT_PROVIDERS as unknown[]).toEqual(
      expect.arrayContaining([
        MessageSubscriberRegistry,
        SystemMessageEventStagerService,
        SystemMessageFanoutService,
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
    expect(MESSAGE_MANAGEMENT_EXPORTS as unknown[]).toEqual(
      expect.arrayContaining([
        MessageSubscriberRegistry,
        SYSTEM_MESSAGE_EVENT_STAGER,
        SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
      ]),
    );

    const qqbotSubscriberProviders = getModuleMetadata<unknown>(
      QqbotMessageSubscriberModule,
      MODULE_METADATA.PROVIDERS,
    );
    const qqbotSubscriberImports = getModuleMetadata<unknown>(
      QqbotMessageSubscriberModule,
      MODULE_METADATA.IMPORTS,
    );
    expect(qqbotSubscriberImports).toContain(AdminAuthGuardModule);
    expect(qqbotSubscriberProviders).toEqual(
      expect.arrayContaining([
        QqbotMessageSubscriberAdapter,
        SystemMessageDeliveryRunnerService,
      ]),
    );
    expect(qqbotSubscriberProviders).not.toContain(SystemMessageFanoutService);

    const noticeProviders = getModuleMetadata<unknown>(
      NoticeModule,
      MODULE_METADATA.PROVIDERS,
    );
    expect(noticeProviders).toContain(StationNoticeMessageSubscriberAdapter);
  });

  it('keeps message source adaptation out of both concrete subscriber directories', () => {
    const qqbotSource = readFileSync(
      join(
        process.cwd(),
        'src/modules/qqbot/message-management-adapter/qqbot-message-subscriber.adapter.ts',
      ),
      'utf8',
    );
    const stationSource = readFileSync(
      join(
        process.cwd(),
        'src/modules/admin/platform-config/notice/station-notice-message-subscriber.adapter.ts',
      ),
      'utf8',
    );

    expect(`${qqbotSource}\n${stationSource}`).not.toMatch(
      /SystemMessageSourceRegistry|SystemMessageSourceAdapter|resolveDelivery|inspectSubscription|waiting_ddns/,
    );
    expect(qqbotSource).toMatch(/input\.message\.templates/);
    expect(stationSource).toMatch(/input\.message\.templates/);
  });

  it('keeps QQBot core free of generic and subscriber-specific message entities/providers', () => {
    expect(getNames(QQBOT_CORE_ENTITIES)).not.toEqual(
      expect.arrayContaining([
        'MessageEvent',
        'MessageSubscription',
        'MessageSubscriptionTemplate',
        'MessageTemplate',
        'QqbotMessageDelivery',
        'QqbotMessagePublishBinding',
        'QqbotMessagePublishTarget',
      ]),
    );
    expect(getNames(QQBOT_CORE_PROVIDERS)).not.toEqual(
      expect.arrayContaining([
        'MessageSubscriberRegistry',
        'SystemMessageFanoutService',
        'SystemMessageDeliveryCoordinatorService',
        'SystemMessageDeliveryRunnerService',
      ]),
    );
    expect(getNames(QQBOT_CORE_EXPORTS)).not.toEqual(
      expect.arrayContaining([
        'SystemMessageEventStagerService',
        'SystemMessageDeliveryCoordinatorService',
      ]),
    );
  });

  it('maps core, generic-message, and subscriber-private entities to the SQL schema', () => {
    const entities = [
      ...QQBOT_CORE_ENTITIES,
      ...MESSAGE_MANAGEMENT_ENTITIES,
      ...QQBOT_MESSAGE_SUBSCRIBER_ENTITIES,
      StationNoticeMessageBinding,
    ] as EntityClass[];

    for (const entity of entities) {
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
