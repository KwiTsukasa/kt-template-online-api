import { QQBOT_CORE_DOMAIN_CONTRACT } from '../../../../src/modules/qqbot/core/contract/qqbot-core.contract';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

describe('QQBot core status contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps OneBot connection, container, WebUI and QQ login status as separate account fields', () => {
    expect(QQBOT_CORE_DOMAIN_CONTRACT.status).toEqual({
      accountTable: 'qqbot_account',
      oneBotField: 'onebot_status',
      containerField: 'container_status',
      webuiField: 'webui_status',
      qqLoginField: 'qq_login_status',
      lastErrorField: 'last_error',
      connectionSessionTable: 'qqbot_connection_session',
      sessionStatusField: 'status',
      closeReasonField: 'close_reason',
    });

    schema.expectTableColumns('qqbot_account', [
      'id',
      'self_id',
      'onebot_status',
      'container_status',
      'webui_status',
      'qq_login_status',
      'last_error',
    ]);
    schema.expectTableColumns('qqbot_connection_session', [
      'id',
      'account_id',
      'session_key',
      'status',
      'connected_at',
      'disconnected_at',
      'close_reason',
    ]);
  });
});
