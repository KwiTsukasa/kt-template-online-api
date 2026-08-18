import { getMetadataArgsStorage } from 'typeorm';
import { StationNoticeMessageBinding } from '../../../../src/modules/admin/platform-config/notice/station-notice-message-binding.entity';
import { MessageEvent } from '../../../../src/modules/message-management/infrastructure/persistence/message-event.entity';
import { MessageSubscription } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-template.entity';
import { MESSAGE_MANAGEMENT_ENTITIES } from '../../../../src/modules/message-management/message-management.module';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-delivery.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-publish-target.entity';
import { QQBOT_MESSAGE_SUBSCRIBER_ENTITIES } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-subscriber.module';

type EntityClass = new (...args: never[]) => unknown;
type ColumnContract = {
  default: boolean | number | string | null;
  length: number | null;
  name: string;
  nullable: boolean;
  precision: number | null;
  primary: boolean;
  propertyName: string;
  type: string;
  unsigned: boolean;
};

const columnName = (propertyName: string) =>
  propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const varchar = (
  propertyName: string,
  length: number,
  nullable = false,
): ColumnContract => ({
  default: null,
  length,
  name: columnName(propertyName),
  nullable,
  precision: null,
  primary: false,
  propertyName,
  type: 'varchar',
  unsigned: false,
});

const bigint = (
  propertyName: string,
  nullable = false,
  primary = false,
): ColumnContract => ({
  default: null,
  length: null,
  name: columnName(propertyName),
  nullable,
  precision: null,
  primary,
  propertyName,
  type: 'bigint',
  unsigned: false,
});

const datetime = (propertyName: string, nullable = false): ColumnContract => ({
  default: null,
  length: null,
  name: columnName(propertyName),
  nullable,
  precision: 6,
  primary: false,
  propertyName,
  type: 'datetime',
  unsigned: false,
});

const generatedDatetime = (propertyName: string): ColumnContract => ({
  ...datetime(propertyName),
  default: 'CURRENT_TIMESTAMP(6)',
});

const booleanColumn = (
  propertyName: string,
  defaultValue: boolean,
): ColumnContract => ({
  default: defaultValue,
  length: null,
  name: columnName(propertyName),
  nullable: false,
  precision: null,
  primary: false,
  propertyName,
  type: 'tinyint',
  unsigned: false,
});

const persistenceContract: ReadonlyArray<{
  columns: readonly ColumnContract[];
  entity: EntityClass;
  indexes: ReadonlyArray<{
    columns: readonly string[];
    name: string;
    unique: boolean;
  }>;
  table: string;
}> = [
  {
    columns: [
      bigint('id', false, true),
      varchar('name', 100),
      varchar('subscriberKey', 64),
      { ...varchar('templateBindingDigest', 64), type: 'char' },
      { ...varchar('sourceConfig', 0), length: null, type: 'json' },
      { ...varchar('sourceConfigDigest', 64), type: 'char' },
      varchar('activeKey', 255, true),
      booleanColumn('enabled', true),
      varchar('remark', 500, true),
      booleanColumn('isDeleted', false),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: MessageSubscription,
    indexes: [
      {
        columns: ['activeKey'],
        name: 'uk_message_subscription_active_key',
        unique: true,
      },
    ],
    table: 'message_subscription',
  },
  {
    columns: [
      bigint('subscriptionId', false, true),
      bigint('templateId', false, true),
      {
        ...varchar('sortOrder', 0),
        default: null,
        length: null,
        type: 'int',
        unsigned: true,
      },
    ],
    entity: MessageSubscriptionTemplate,
    indexes: [
      {
        columns: ['subscriptionId', 'sortOrder'],
        name: 'uk_message_subscription_template_order',
        unique: true,
      },
    ],
    table: 'message_subscription_template',
  },
  {
    columns: [
      bigint('id', false, true),
      varchar('name', 100),
      varchar('sourceKey', 128),
      { ...varchar('content', 0), length: null, type: 'text' },
      booleanColumn('enabled', true),
      varchar('remark', 500, true),
      booleanColumn('isDeleted', false),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: MessageTemplate,
    indexes: [],
    table: 'message_template',
  },
  {
    columns: [
      bigint('id', false, true),
      varchar('eventId', 128),
      varchar('sourceKey', 128),
      varchar('resourceKey', 128),
      datetime('occurredAt'),
      { ...varchar('payload', 0), length: null, type: 'json' },
      { ...varchar('fanoutStatus', 32), default: 'accepted' },
      {
        ...varchar('fanoutAttemptCount', 0),
        default: 0,
        length: null,
        type: 'int',
        unsigned: true,
      },
      datetime('nextFanoutAt', true),
      datetime('fanoutLeaseUntil', true),
      varchar('lastErrorCode', 64, true),
      varchar('lastErrorMessage', 500, true),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: MessageEvent,
    indexes: [
      { columns: ['eventId'], name: 'uk_message_event_event_id', unique: true },
      {
        columns: ['fanoutStatus', 'nextFanoutAt'],
        name: 'idx_message_event_dispatch',
        unique: false,
      },
      {
        columns: ['fanoutLeaseUntil'],
        name: 'idx_message_event_lease',
        unique: false,
      },
      {
        columns: ['sourceKey', 'resourceKey', 'occurredAt', 'id'],
        name: 'idx_message_event_source_resource_order',
        unique: false,
      },
    ],
    table: 'message_event',
  },
  {
    columns: [
      bigint('id', false, true),
      bigint('subscriptionId'),
      bigint('accountId'),
      varchar('selfId', 64),
      varchar('activeKey', 255, true),
      booleanColumn('enabled', true),
      booleanColumn('isDeleted', false),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: QqbotMessagePublishBinding,
    indexes: [
      {
        columns: ['activeKey'],
        name: 'uk_qqbot_message_publish_binding_active_key',
        unique: true,
      },
    ],
    table: 'qqbot_message_publish_binding',
  },
  {
    columns: [
      bigint('id', false, true),
      bigint('bindingId'),
      varchar('targetType', 16),
      varchar('targetId', 64),
      varchar('targetName', 120, true),
      varchar('activeKey', 300, true),
      booleanColumn('enabled', true),
      booleanColumn('isDeleted', false),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: QqbotMessagePublishTarget,
    indexes: [
      {
        columns: ['activeKey'],
        name: 'uk_qqbot_message_publish_target_active_key',
        unique: true,
      },
    ],
    table: 'qqbot_message_publish_target',
  },
  {
    columns: [
      bigint('id', false, true),
      bigint('messageEventId'),
      bigint('publishTargetId'),
      bigint('bindingId'),
      bigint('subscriptionId'),
      varchar('selfId', 64),
      varchar('targetType', 16),
      varchar('targetId', 64),
      bigint('templateId'),
      { ...varchar('templateContent', 0), length: null, type: 'text' },
      { ...varchar('variableSnapshot', 0), length: null, type: 'json' },
      { ...varchar('renderedMessage', 0), length: null, type: 'text' },
      varchar('status', 32),
      {
        ...varchar('attemptCount', 0),
        default: 0,
        length: null,
        type: 'int',
        unsigned: true,
      },
      datetime('nextAttemptAt', true),
      datetime('processingLeaseUntil', true),
      bigint('sendLogId', true),
      varchar('lastErrorCode', 64, true),
      varchar('lastErrorMessage', 500, true),
      datetime('expiresAt'),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: QqbotMessageDelivery,
    indexes: [
      {
        columns: ['messageEventId', 'publishTargetId', 'templateId'],
        name: 'uk_qqbot_message_delivery_event_target_template',
        unique: true,
      },
      {
        columns: ['status', 'nextAttemptAt'],
        name: 'idx_qqbot_message_delivery_dispatch',
        unique: false,
      },
      {
        columns: ['processingLeaseUntil'],
        name: 'idx_qqbot_message_delivery_lease',
        unique: false,
      },
      {
        columns: ['subscriptionId', 'messageEventId'],
        name: 'idx_qqbot_message_delivery_history',
        unique: false,
      },
    ],
    table: 'qqbot_message_delivery',
  },
  {
    columns: [
      bigint('id', false, true),
      bigint('subscriptionId'),
      varchar('title', 255),
      varchar('notifyRoleCode', 64),
      booleanColumn('enabled', true),
      varchar('activeKey', 255, true),
      booleanColumn('isDeleted', false),
      generatedDatetime('createTime'),
      generatedDatetime('updateTime'),
    ],
    entity: StationNoticeMessageBinding,
    indexes: [
      {
        columns: ['activeKey'],
        name: 'uk_station_notice_message_binding_active_key',
        unique: true,
      },
    ],
    table: 'station_notice_message_binding',
  },
];

const normalizeColumnType = (type: unknown) => {
  if (type === String) return 'varchar';
  if (type === Boolean) return 'tinyint';
  return `${type}`.toLowerCase();
};

const sortByPropertyName = <T extends { propertyName: string }>(
  values: readonly T[],
) =>
  [...values].sort((left, right) =>
    left.propertyName.localeCompare(right.propertyName),
  );

const getColumns = (entity: EntityClass): ColumnContract[] =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => ({
      default:
        typeof column.options.default === 'function'
          ? column.options.default()
          : (column.options.default ?? null),
      length:
        column.options.length === undefined
          ? null
          : Number(column.options.length),
      name: `${column.options.name || column.propertyName}`,
      nullable: column.options.nullable === true,
      precision:
        column.options.precision === undefined
          ? null
          : Number(column.options.precision),
      primary: column.options.primary === true,
      propertyName: `${column.propertyName}`,
      type:
        column.options.type === undefined &&
        ['createDate', 'updateDate'].includes(column.mode)
          ? 'datetime'
          : normalizeColumnType(column.options.type),
      unsigned: column.options.unsigned === true,
    }))
    .sort((left, right) => left.propertyName.localeCompare(right.propertyName));

const getIndexes = (entity: EntityClass) =>
  getMetadataArgsStorage()
    .indices.filter((index) => index.target === entity)
    .map((index) => ({
      columns: Array.isArray(index.columns)
        ? index.columns.map((column) => `${column}`)
        : [],
      name: index.name,
      unique: index.unique === true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

describe('message management persistence contract', () => {
  it('registers generic entities in message management and QQBot entities only in its subscriber module', () => {
    expect(MESSAGE_MANAGEMENT_ENTITIES).toEqual([
      MessageEvent,
      MessageSubscription,
      MessageSubscriptionTemplate,
      MessageTemplate,
    ]);
    expect(QQBOT_MESSAGE_SUBSCRIBER_ENTITIES).toEqual([
      QqbotMessageDelivery,
      QqbotMessagePublishBinding,
      QqbotMessagePublishTarget,
    ]);
  });

  it('maps every protocol and subscriber table to its exact column contract', () => {
    for (const { columns, entity, table } of persistenceContract) {
      const metadataTable = getMetadataArgsStorage().tables.find(
        (entry) => entry.target === entity,
      );
      expect(metadataTable?.name).toBe(table);
      expect(getColumns(entity)).toEqual(sortByPropertyName(columns));
    }
  });

  it('keeps all natural-key, ordering, dispatch, lease, and history indexes exact', () => {
    for (const { entity, indexes } of persistenceContract) {
      expect(getIndexes(entity)).toEqual(
        [...indexes].sort((left, right) => left.name.localeCompare(right.name)),
      );
    }
  });

  it('declares identifier properties as strings without ORM relations or foreign keys', () => {
    const metadata = getMetadataArgsStorage();
    for (const { columns, entity } of persistenceContract) {
      for (const { propertyName } of columns.filter(
        ({ propertyName }) =>
          propertyName === 'id' || propertyName.endsWith('Id'),
      )) {
        expect(
          Reflect.getMetadata('design:type', entity.prototype, propertyName),
        ).toBe(String);
      }
      expect(
        metadata.relations.filter((relation) => relation.target === entity),
      ).toEqual([]);
      expect(
        (metadata.foreignKeys || []).filter(
          (foreignKey) => foreignKey.target === entity,
        ),
      ).toEqual([]);
    }
  });
});
