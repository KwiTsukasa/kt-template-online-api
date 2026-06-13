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
});
