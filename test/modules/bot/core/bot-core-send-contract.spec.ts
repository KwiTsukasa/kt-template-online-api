import { BOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/bot-adapter/core/contract/bot-core.contract';
import { BotSendAttemptError } from '../../../../src/modules/bot-adapter/core/application/send/bot-send.error';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot core send contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps send queue reservation, rate limit, send log and dedupe event contracts explicit', () => {
    expect(BOT_CORE_DOMAIN_CONTRACT.messageSend).toEqual({
      conversationTable: 'bot_conversation',
      messageTable: 'bot_message',
      sendQueueTable: 'bot_send_task',
      queueTaskKeyField: 'task_key',
      queueStatusField: 'status',
      queuePayloadField: 'payload_json',
      queueReservedAtField: 'reserved_at',
      queueSentAtField: 'sent_at',
      sendLogTable: 'bot_send_log',
      sendLogStatusField: 'status',
      sendLogSafeSummaryField: 'safe_summary',
      dedupeTable: 'bot_dedupe_event',
      dedupeKeyField: 'dedupe_key',
      dedupeExpiresAtField: 'expires_at',
      rateLimitProvider: 'BotRateLimitService',
    });

    schema.expectTableColumns('bot_conversation', [
      'id',
      'account_id',
      'conversation_type',
      'conversation_key',
    ]);
    schema.expectTableColumns('bot_message', [
      'id',
      'account_id',
      'conversation_id',
      'message_id',
      'direction',
      'message_type',
      'raw_payload',
    ]);
    schema.expectTableColumns('bot_send_task', [
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
    schema.expectTableColumns('bot_send_log', [
      'id',
      'task_id',
      'account_id',
      'status',
      'safe_summary',
      'error_message',
    ]);
    schema.expectTableColumns('bot_dedupe_event', [
      'id',
      'dedupe_key',
      'account_id',
      'expires_at',
    ]);
  });

  it('keeps strict delivery error classification explicit', () => {
    const error = new BotSendAttemptError({
      code: 'onebot_disconnected',
      message: 'OneBot unavailable',
      retryable: true,
      sendLogId: null,
    });

    expect(error).toMatchObject({
      code: 'onebot_disconnected',
      name: 'BotSendAttemptError',
      retryable: true,
      sendLogId: null,
    });
  });
});
