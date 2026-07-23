import { getMetadataArgsStorage } from 'typeorm';
import {
  QQBOT_CORE_ENTITIES,
} from '../../../../src/modules/qqbot/core/qqbot-core.module';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageEvent } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-event.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageSubscription } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';

const messagePushEntities = [
  QqbotMessageSubscription,
  QqbotMessageTemplate,
  QqbotMessagePublishBinding,
  QqbotMessagePublishTarget,
  QqbotMessageEvent,
  QqbotMessageDelivery,
];

const expectedColumns = {
  qqbot_message_delivery: [
    'id', 'message_event_id', 'publish_target_id', 'binding_id',
    'subscription_id', 'self_id', 'target_type', 'target_id', 'template_id',
    'template_content', 'variable_snapshot', 'rendered_message', 'status',
    'attempt_count', 'next_attempt_at', 'processing_lease_until',
    'send_log_id', 'last_error_code', 'last_error_message', 'expires_at',
    'create_time', 'update_time',
  ],
  qqbot_message_event: [
    'id', 'event_id', 'source_key', 'resource_key', 'occurred_at', 'payload',
    'fanout_status', 'fanout_attempt_count', 'next_fanout_at',
    'fanout_lease_until', 'last_error_code', 'last_error_message',
    'create_time', 'update_time',
  ],
  qqbot_message_publish_binding: [
    'id', 'subscription_id', 'account_id', 'self_id', 'template_id',
    'active_key', 'enabled', 'is_deleted', 'create_time', 'update_time',
  ],
  qqbot_message_publish_target: [
    'id', 'binding_id', 'target_type', 'target_id', 'target_name',
    'active_key', 'enabled', 'is_deleted', 'create_time', 'update_time',
  ],
  qqbot_message_subscription: [
    'id', 'name', 'source_key', 'source_config', 'source_config_digest',
    'active_key', 'enabled', 'remark', 'is_deleted', 'create_time',
    'update_time',
  ],
  qqbot_message_template: [
    'id', 'name', 'source_key', 'content', 'enabled', 'remark',
    'is_deleted', 'create_time', 'update_time',
  ],
} as const;

/** Reads the table name declared by a TypeORM entity. */
const tableNameOf = (entity: object) =>
  getMetadataArgsStorage().tables.find((table) => table.target === entity)
    ?.name;

/** Reads the database column names declared by a TypeORM entity. */
const columnNamesOf = (entity: object) =>
  getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);

describe('QQBot message-push persistence contract', () => {
  it('registers the six message-push entities in QQBot Core', () => {
    expect(QQBOT_CORE_ENTITIES).toEqual(
      expect.arrayContaining(messagePushEntities),
    );
  });

  it('maps every required message-push column with string Snowflake IDs', () => {
    for (const entity of messagePushEntities) {
      const tableName = tableNameOf(entity);

      expect(tableName).toBeTruthy();
      expect(columnNamesOf(entity)).toEqual(
        expect.arrayContaining([...expectedColumns[tableName as keyof typeof expectedColumns]]),
      );
    }
  });
});
