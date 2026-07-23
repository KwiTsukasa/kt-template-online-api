import { getMetadataArgsStorage } from 'typeorm';
import { QQBOT_CORE_ENTITIES } from '../../../../src/modules/qqbot/core/qqbot-core.module';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';

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

/** Builds an expected varchar metadata tuple without consulting production contracts. */
const varchar = (propertyName: string, length: number, nullable = false): ColumnContract => ({ default: null, length, name: propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), nullable, precision: null, primary: false, propertyName, type: 'varchar', unsigned: false });
/** Builds an expected bigint metadata tuple without consulting production contracts. */
const bigint = (propertyName: string, nullable = false, primary = false): ColumnContract => ({ default: null, length: null, name: propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), nullable, precision: null, primary, propertyName, type: 'bigint', unsigned: false });
/** Builds an expected datetime(6) metadata tuple without consulting production contracts. */
const datetime = (propertyName: string, nullable = false): ColumnContract => ({ default: null, length: null, name: propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), nullable, precision: 6, primary: false, propertyName, type: 'datetime', unsigned: false });
/** Builds an expected tinyint boolean metadata tuple without consulting production contracts. */
const boolean = (propertyName: string, defaultValue: boolean): ColumnContract => ({ default: defaultValue, length: null, name: propertyName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), nullable: false, precision: null, primary: false, propertyName, type: 'tinyint', unsigned: false });

const persistenceContract: ReadonlyArray<{
  columns: readonly ColumnContract[];
  entity: EntityClass;
  indexes: ReadonlyArray<{ columns: readonly string[]; name: string; unique: boolean }>;
  table: string;
}> = [
  {
    entity: QqbotMessageSubscription,
    table: 'qqbot_message_subscription',
    columns: [
      bigint('id', false, true), varchar('name', 100), varchar('sourceKey', 128),
      { ...varchar('sourceConfig', 0), length: null, type: 'json' },
      { ...varchar('sourceConfigDigest', 64), type: 'char' }, varchar('activeKey', 255, true),
      boolean('enabled', true), varchar('remark', 500, true), boolean('isDeleted', false),
      datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [{ name: 'uk_qqbot_message_subscription_active_key', columns: ['activeKey'], unique: true }],
  },
  {
    entity: QqbotMessageTemplate,
    table: 'qqbot_message_template',
    columns: [
      bigint('id', false, true), varchar('name', 100), varchar('sourceKey', 128),
      { ...varchar('content', 0), length: null, type: 'text' }, boolean('enabled', true),
      varchar('remark', 500, true), boolean('isDeleted', false), datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [],
  },
  {
    entity: QqbotMessagePublishBinding,
    table: 'qqbot_message_publish_binding',
    columns: [
      bigint('id', false, true), bigint('subscriptionId'), bigint('accountId'), varchar('selfId', 64),
      bigint('templateId'), varchar('activeKey', 255, true), boolean('enabled', true),
      boolean('isDeleted', false), datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [{ name: 'uk_qqbot_message_publish_binding_active_key', columns: ['activeKey'], unique: true }],
  },
  {
    entity: QqbotMessagePublishTarget,
    table: 'qqbot_message_publish_target',
    columns: [
      bigint('id', false, true), bigint('bindingId'), varchar('targetType', 16), varchar('targetId', 64),
      varchar('targetName', 120, true), varchar('activeKey', 300, true), boolean('enabled', true),
      boolean('isDeleted', false), datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [{ name: 'uk_qqbot_message_publish_target_active_key', columns: ['activeKey'], unique: true }],
  },
  {
    entity: QqbotMessageEvent,
    table: 'qqbot_message_event',
    columns: [
      bigint('id', false, true), varchar('eventId', 128), varchar('sourceKey', 128), varchar('resourceKey', 128),
      datetime('occurredAt'), { ...varchar('payload', 0), length: null, type: 'json' },
      { ...varchar('fanoutStatus', 32), default: 'accepted' },
      { ...varchar('fanoutAttemptCount', 0), default: 0, length: null, type: 'int', unsigned: true },
      datetime('nextFanoutAt', true), datetime('fanoutLeaseUntil', true), varchar('lastErrorCode', 64, true),
      varchar('lastErrorMessage', 500, true), datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [
      { name: 'uk_qqbot_message_event_event_id', columns: ['eventId'], unique: true },
      { name: 'idx_qqbot_message_event_dispatch', columns: ['fanoutStatus', 'nextFanoutAt'], unique: false },
      { name: 'idx_qqbot_message_event_lease', columns: ['fanoutLeaseUntil'], unique: false },
    ],
  },
  {
    entity: QqbotMessageDelivery,
    table: 'qqbot_message_delivery',
    columns: [
      bigint('id', false, true), bigint('messageEventId'), bigint('publishTargetId'), bigint('bindingId'),
      bigint('subscriptionId'), varchar('selfId', 64), varchar('targetType', 16), varchar('targetId', 64),
      bigint('templateId'), { ...varchar('templateContent', 0), length: null, type: 'text' },
      { ...varchar('variableSnapshot', 0), length: null, type: 'json' }, { ...varchar('renderedMessage', 0), length: null, type: 'text' },
      varchar('status', 32), { ...varchar('attemptCount', 0), default: 0, length: null, type: 'int', unsigned: true },
      datetime('nextAttemptAt', true), datetime('processingLeaseUntil', true), bigint('sendLogId', true),
      varchar('lastErrorCode', 64, true), varchar('lastErrorMessage', 500, true), datetime('expiresAt'),
      datetime('createTime'), datetime('updateTime'),
    ],
    indexes: [
      { name: 'uk_qqbot_message_delivery_event_target', columns: ['messageEventId', 'publishTargetId'], unique: true },
      { name: 'idx_qqbot_message_delivery_dispatch', columns: ['status', 'nextAttemptAt'], unique: false },
      { name: 'idx_qqbot_message_delivery_lease', columns: ['processingLeaseUntil'], unique: false },
      { name: 'idx_qqbot_message_delivery_history', columns: ['subscriptionId', 'messageEventId'], unique: false },
    ],
  },
];

/** Converts TypeORM's constructor shorthand into its SQL-facing type name. */
const normalizeColumnType = (type: unknown) => {
  if (type === String) return 'varchar';
  if (type === Boolean) return 'tinyint';
  return `${type}`.toLowerCase();
};

/** Reads an entity's TypeORM column metadata into a stable comparison tuple. */
const getColumns = (entity: EntityClass): ColumnContract[] => getMetadataArgsStorage()
  .columns.filter((column) => column.target === entity)
  .map((column) => ({
    default: column.options.default ?? null,
    length: column.options.length === undefined ? null : Number(column.options.length),
    name: `${column.options.name || column.propertyName}`,
    nullable: column.options.nullable === true,
    precision: column.options.precision === undefined ? null : Number(column.options.precision),
    primary: column.options.primary === true,
    propertyName: `${column.propertyName}`,
    type: column.options.type === undefined && ['createDate', 'updateDate'].includes(column.mode)
      ? 'datetime'
      : normalizeColumnType(column.options.type),
    unsigned: column.options.unsigned === true,
  }));

/** Reads an entity's TypeORM index definitions into exact name/column/unique tuples. */
const getIndexes = (entity: EntityClass) => getMetadataArgsStorage().indices
  .filter((index) => index.target === entity)
  .map((index) => ({
    columns: Array.isArray(index.columns) ? index.columns.map((column) => `${column}`) : [],
    name: index.name,
    unique: index.unique === true,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

describe('QQBot message-push persistence contract', () => {
  it('registers exactly the six message-push entities in QQBot Core', () => {
    expect(QQBOT_CORE_ENTITIES).toEqual(expect.arrayContaining(persistenceContract.map(({ entity }) => entity)));
  });

  it('maps every table to its independent exact column metadata matrix', () => {
    for (const { columns, entity, table } of persistenceContract) {
      const metadataTable = getMetadataArgsStorage().tables.find((entry) => entry.target === entity);
      expect(metadataTable?.name).toBe(table);
      expect(getColumns(entity)).toEqual(columns);
    }
  });

  it('marks create and update timestamps as generated TypeORM timestamp columns', () => {
    for (const { entity } of persistenceContract) {
      const timestamps = getMetadataArgsStorage().columns
        .filter((column) => column.target === entity)
        .filter((column) => ['createTime', 'updateTime'].includes(`${column.propertyName}`))
        .map((column) => ({
          mode: column.mode,
          precision: column.options.precision,
          type: column.options.type === undefined ? 'datetime' : normalizeColumnType(column.options.type),
        }));
      expect(timestamps).toEqual([
        { mode: 'createDate', precision: 6, type: 'datetime' },
        { mode: 'updateDate', precision: 6, type: 'datetime' },
      ]);
    }
  });

  it('keeps all unique, dispatch, lease, and history indexes as exact tuples', () => {
    for (const { entity, indexes } of persistenceContract) {
      expect(getIndexes(entity)).toEqual([...indexes].sort((left, right) => left.name.localeCompare(right.name)));
    }
  });

  it('keeps every identifier property as a string and declares no ORM relations or foreign keys', () => {
    const metadata = getMetadataArgsStorage();
    for (const { columns, entity } of persistenceContract) {
      for (const { propertyName } of columns.filter(({ propertyName }) => propertyName === 'id' || propertyName.endsWith('Id'))) {
        expect(Reflect.getMetadata('design:type', entity.prototype, propertyName)).toBe(String);
      }
      expect(metadata.relations.filter((relation) => relation.target === entity)).toEqual([]);
      expect((metadata.foreignKeys || []).filter((foreignKey) => foreignKey.target === entity)).toEqual([]);
    }
  });
});
