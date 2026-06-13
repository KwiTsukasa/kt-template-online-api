import { RuntimeEvidenceService } from '../../src/runtime/evidence/runtime-evidence.service';

describe('RuntimeEvidenceService', () => {
  it('creates records with explicit timing, duration, and schema version', () => {
    const service = new RuntimeEvidenceService();
    const startedAt = new Date('2026-06-13T00:00:00.000Z');
    const endedAt = new Date('2026-06-13T00:00:01.250Z');

    const record = service.createRecord({
      title: 'runtime config smoke',
      taskType: 'backend',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'runtime-config',
      status: 'passed',
      startedAt,
      endedAt,
    });

    expect(record.startedAt).toBe(startedAt);
    expect(record.endedAt).toBe(endedAt);
    expect(record.durationMs).toBe(1250);
    expect(record.schemaVersion).toBe(1);
  });

  it('keeps duration non-negative when evidence ends before it starts', () => {
    const service = new RuntimeEvidenceService();
    const startedAt = new Date('2026-06-13T00:00:01.250Z');
    const endedAt = new Date('2026-06-13T00:00:00.000Z');

    const record = service.createRecord({
      title: 'runtime config smoke',
      taskType: 'backend',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'runtime-config',
      status: 'failed',
      startedAt,
      endedAt,
    });

    expect(record.durationMs).toBe(0);
  });

  it('redacts nested sensitive fields in details and cleanup details', () => {
    const service = new RuntimeEvidenceService();

    const record = service.createRecord({
      title: 'qqbot captcha smoke',
      taskType: 'api',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'qqbot-login',
      target: 'account:2637330537',
      status: 'blocked',
      details: {
        username: 'kept-user',
        password: 1,
        nested: {
          token: true,
          message: 'kept-message',
          replyText: 'raw-reply-text',
        },
      },
      cleanup: {
        status: 'failed',
        message: 'cleanup failed',
        details: {
          ticket: 'raw-ticket',
          randstr: 'raw-randstr',
          removed: false,
        },
      },
    });

    expect(record.details).toEqual({
      username: 'kept-user',
      password: '<redacted>',
      nested: {
        token: '<redacted>',
        message: 'kept-message',
        replyText: '<redacted>',
      },
    });
    expect(record.cleanup?.details).toEqual({
      ticket: '<redacted>',
      randstr: '<redacted>',
      removed: false,
    });
  });

  it('sanitizes arrays and case-insensitive sensitive keys while preserving dates', () => {
    const service = new RuntimeEvidenceService();
    const createdAt = new Date('2026-06-13T00:00:00.000Z');

    const record = service.createRecord({
      title: 'array evidence',
      taskType: 'backend',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'runtime-evidence',
      status: 'failed',
      details: {
        events: [
          { Authorization: 'Bearer raw', name: 'kept' },
          { nested: { Cookie: 'session=raw', count: 2 } },
        ],
        createdAt,
      },
    });

    const details = record.details as {
      events: Array<Record<string, unknown>>;
      createdAt: Date;
    };

    expect(details.createdAt).toBe(createdAt);
    expect(details.createdAt).toBeInstanceOf(Date);
    expect(details.events).toHaveLength(2);
    expect(details.events[0]).toEqual({
      Authorization: '<redacted>',
      name: 'kept',
    });
    expect(details.events[1]).toEqual({
      nested: {
        Cookie: '<redacted>',
        count: 2,
      },
    });
  });

  it('sanitizes sensitive key-value text across the whole evidence record without mutating input', () => {
    const service = new RuntimeEvidenceService();
    const input = {
      title: 'safe title token=raw-token',
      taskType: 'api',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'qqbot-login',
      target: 'account safe text Authorization=Bearer raw-token',
      status: 'failed' as const,
      error: {
        category: 'operation_failed' as const,
        operation: 'captcha',
        message: 'safe error message ticket=raw-ticket',
        cause:
          'safe cause randstr=raw-randstr Authorization: Bearer raw-token Cookie=session=raw-cookie',
        retryable: false,
      },
      assertions: [
        {
          name: 'reply text check',
          passed: false,
          message: 'safe assertion replyText=raw-reply-text',
        },
      ],
      cleanup: {
        status: 'failed' as const,
        message: 'safe cleanup Cookie=session=raw-cookie',
      },
    };

    const record = service.createRecord(input);
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('raw-ticket');
    expect(serialized).not.toContain('raw-randstr');
    expect(serialized).not.toContain('raw-token');
    expect(serialized).not.toContain('raw-cookie');
    expect(serialized).not.toContain('raw-reply-text');
    expect(serialized).toContain('safe title');
    expect(serialized).toContain('safe error message');
    expect(serialized).toContain('safe cause');
    expect(serialized).toContain('safe assertion');
    expect(serialized).toContain('safe cleanup');
    expect(input.title).toContain('raw-token');
    expect(input.error.message).toContain('raw-ticket');
    expect(input.error.cause).toContain('raw-randstr');
    expect(input.assertions[0].message).toContain('raw-reply-text');
    expect(input.cleanup.message).toContain('raw-cookie');
  });

  it('redacts captcha sid, snake_case secret keys, JSON secret text, and base64 payloads', () => {
    const service = new RuntimeEvidenceService();
    const rawBase64Payload = `data:image/png;base64,${'A'.repeat(160)}`;

    const record = service.createRecord({
      title: 'captcha evidence',
      taskType: 'api',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'qqbot-login',
      status: 'blocked',
      details: {
        sid: 'raw-captcha-sid',
        private_key: 'raw-private-key',
        ssh_key: 'raw-ssh-key',
        imageBase64: rawBase64Payload,
        text: 'sid=raw-text-sid private_key=raw-text-private-key ssh_key=raw-text-ssh-key',
        jsonText:
          '{"sid":"raw-json-sid","token":"raw-json-token","safe":"kept"}',
      },
    });

    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('raw-captcha-sid');
    expect(serialized).not.toContain('raw-private-key');
    expect(serialized).not.toContain('raw-ssh-key');
    expect(serialized).not.toContain('raw-text-sid');
    expect(serialized).not.toContain('raw-text-private-key');
    expect(serialized).not.toContain('raw-text-ssh-key');
    expect(serialized).not.toContain('raw-json-sid');
    expect(serialized).not.toContain('raw-json-token');
    expect(serialized).not.toContain(rawBase64Payload);
    expect(serialized).toContain('captcha evidence');
    expect(serialized).toContain('kept');
  });

  it('redacts compound token and secret text keys while preserving session identifiers', () => {
    const service = new RuntimeEvidenceService();

    const record = service.createRecord({
      title: 'compound token evidence',
      taskType: 'api',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'admin-login',
      target: 'sessionId=KT_SCAN_SAFE',
      status: 'failed',
      details: {
        sessionId: 'KT_SCAN_SAFE',
        text:
          'accessToken=raw-access-token refreshToken=raw-refresh-token access_token=raw-snake-token client_secret=raw-client-secret sessionId=KT_SCAN_SAFE',
        jsonText:
          '{"accessToken":"raw-json-access","refreshToken":"raw-json-refresh","access_token":"raw-json-snake","client_secret":"raw-json-client-secret","sessionId":"KT_SCAN_SAFE"}',
      },
    });

    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('raw-access-token');
    expect(serialized).not.toContain('raw-refresh-token');
    expect(serialized).not.toContain('raw-snake-token');
    expect(serialized).not.toContain('raw-client-secret');
    expect(serialized).not.toContain('raw-json-access');
    expect(serialized).not.toContain('raw-json-refresh');
    expect(serialized).not.toContain('raw-json-snake');
    expect(serialized).not.toContain('raw-json-client-secret');
    expect(serialized).toContain('KT_SCAN_SAFE');
  });

  it('redacts cookie headers, quoted private key values, and non-string JSON secrets', () => {
    const service = new RuntimeEvidenceService();

    const record = service.createRecord({
      title: 'realistic secret text evidence',
      taskType: 'api',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'runtime-evidence',
      status: 'failed',
      details: {
        cookieHeader:
          'Cookie: admin_access_token=raw-cookie-token; wordpress_logged_in=raw-wordpress-cookie; theme=light',
        quotedPrivateKey:
          'private_key="-----BEGIN PRIVATE KEY----- raw pem body -----END PRIVATE KEY-----"',
        jsonText:
          '{"accessToken":12345,"sid":67890,"client_secret":true,"sessionId":"KT_SCAN_SAFE"}',
      },
    });

    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('raw-cookie-token');
    expect(serialized).not.toContain('raw-wordpress-cookie');
    expect(serialized).not.toContain('raw pem body');
    expect(serialized).not.toContain('12345');
    expect(serialized).not.toContain('67890');
    expect(serialized).toContain('KT_SCAN_SAFE');
  });

  it('redacts access key and api key text plus unquoted multi-word secret values', () => {
    const service = new RuntimeEvidenceService();

    const record = service.createRecord({
      title: 'access key evidence',
      taskType: 'backend',
      project: 'kt-template-online-api',
      environment: 'local',
      operation: 'runtime-evidence',
      status: 'failed',
      details: {
        text:
          'accessKey=raw-access-key access_key=raw-snake-access-key apiKey=raw-api-key api_key=raw-snake-api-key private_key=-----BEGIN PRIVATE KEY----- raw unquoted pem token=Bearer raw-bearer-token safe=value',
        jsonText:
          '{"accessKey":"raw-json-access-key","api_key":"raw-json-api-key","safe":"kept"}',
      },
    });

    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain('raw-access-key');
    expect(serialized).not.toContain('raw-snake-access-key');
    expect(serialized).not.toContain('raw-api-key');
    expect(serialized).not.toContain('raw-snake-api-key');
    expect(serialized).not.toContain('raw unquoted pem');
    expect(serialized).not.toContain('raw-bearer-token');
    expect(serialized).not.toContain('raw-json-access-key');
    expect(serialized).not.toContain('raw-json-api-key');
    expect(serialized).toContain('safe=value');
    expect(serialized).toContain('kept');
  });
});
