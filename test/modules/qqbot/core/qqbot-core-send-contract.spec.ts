import { QQBOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/qqbot/core/contract/qqbot-core.contract';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot core send contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps send queue reservation, rate limit, send log and dedupe event contracts explicit', () => {
    expect(QQBOT_CORE_DOMAIN_CONTRACT.messageSend).toEqual({
      conversationTable: 'qqbot_conversation',
      messageTable: 'qqbot_message',
      sendQueueTable: 'qqbot_send_task',
      queueTaskKeyField: 'task_key',
      queueStatusField: 'status',
      queuePayloadField: 'payload_json',
      queueReservedAtField: 'reserved_at',
      queueSentAtField: 'sent_at',
      sendLogTable: 'qqbot_send_log',
      sendLogStatusField: 'status',
      sendLogSafeSummaryField: 'safe_summary',
      dedupeTable: 'qqbot_dedupe_event',
      dedupeKeyField: 'dedupe_key',
      dedupeExpiresAtField: 'expires_at',
      rateLimitProvider: 'QqbotRateLimitService',
    });

    schema.expectTableColumns('qqbot_conversation', [
      'id',
      'account_id',
      'conversation_type',
      'conversation_key',
    ]);
    schema.expectTableColumns('qqbot_message', [
      'id',
      'account_id',
      'conversation_id',
      'message_id',
      'direction',
      'message_type',
      'raw_payload',
    ]);
    schema.expectTableColumns('qqbot_send_task', [
      'id',
      'account_id',
      'conversation_id',
      'task_key',
      'status',
      'payload_json',
      'reserved_at',
      'sent_at',
      'last_error',
    ]);
    schema.expectTableColumns('qqbot_send_log', [
      'id',
      'task_id',
      'account_id',
      'status',
      'safe_summary',
      'error_message',
    ]);
    schema.expectTableColumns('qqbot_dedupe_event', [
      'id',
      'dedupe_key',
      'account_id',
      'expires_at',
    ]);
  });
});
