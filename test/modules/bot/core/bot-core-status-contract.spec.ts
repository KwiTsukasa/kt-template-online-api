import { BOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/bot-adapter/core/contract/bot-core.contract';
import { BotAccount } from '../../../../src/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';
import { getMetadataArgsStorage } from 'typeorm';

describe('QQBot core status contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps OneBot connection, container, WebUI and QQ login status as separate account fields', () => {
    expect(BOT_CORE_DOMAIN_CONTRACT.status).toEqual({
      accountTable: 'bot_account',
      oneBotField: 'onebot_status',
      containerField: 'container_status',
      webuiField: 'webui_status',
      qqLoginField: 'qq_login_status',
      lastErrorField: 'last_error',
      connectionSessionTable: 'bot_connection_session',
      sessionStatusField: 'status',
      closeReasonField: 'close_reason',
    });

    schema.expectTableColumns('bot_account', [
      'id',
      'self_id',
      'onebot_status',
      'container_status',
      'webui_status',
      'qq_login_status',
      'last_error',
    ]);
    schema.expectTableColumns('bot_connection_session', [
      'id',
      'account_id',
      'session_key',
      'status',
      'connected_at',
      'disconnected_at',
      'close_reason',
    ]);
  });

  it('maps split account status columns on the BotAccount entity', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === BotAccount)
      .map((column) => `${column.options.name || column.propertyName}`);

    expect(columns).toEqual(
      expect.arrayContaining([
        'onebot_status',
        'container_status',
        'webui_status',
        'qq_login_status',
      ]),
    );
  });
});
