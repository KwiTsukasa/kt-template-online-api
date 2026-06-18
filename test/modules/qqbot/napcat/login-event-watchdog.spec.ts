import { ToolsService } from '@/common';
import { QqbotNapcatAccountRuntimeService } from '../../../../src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service';
import { NapcatLoginEventService } from '../../../../src/modules/qqbot/napcat/application/runtime/napcat-login-event.service';
import { QqbotNapcatContainerService } from '../../../../src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service';

/**
 * Creates a TypeORM-like repository mock for login-event service tests.
 * @returns Repository mock that captures created and saved login-event payloads.
 */
const createRepository = () => ({
  create: jest.fn((input) => input),
  findOne: jest.fn(),
  save: jest.fn(async (input) => input),
  update: jest.fn(),
});

/**
 * Creates the chained query builder shape used by account runtime joins.
 * @param rows - Rows returned by `getMany()` for the current query.
 * @returns Query builder mock with chainable filter and ordering methods.
 */
const createManyQueryBuilder = <T>(rows: T[]) => ({
  addOrderBy: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(rows),
  orderBy: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
});

describe('NapCat login event and recovery lease', () => {
  it('records quick and password attempts as login events, not send budgets', async () => {
    const repository = createRepository();
    const service = new NapcatLoginEventService(repository as any);

    await service.record({
      accountId: 'account-1',
      containerId: 'container-1',
      eventKind: 'quick_attempt',
      eventSource: 'watchdog',
      eventStatus: 'success',
      evidence: { method: 'quick' },
    });
    await service.record({
      accountId: 'account-1',
      containerId: 'container-1',
      eventKind: 'password_attempt',
      eventSource: 'watchdog',
      eventStatus: 'failed',
      evidence: { method: 'password' },
    });

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(repository.save.mock.calls)).not.toMatch(
      /daily|hour|quota|budget/i,
    );
  });

  it('suspends automatic recovery after captcha, new-device, or manual QR is required', async () => {
    const repository = createRepository();
    const service = new NapcatLoginEventService(repository as any);

    await service.recordSuspended({
      accountId: 'account-1',
      containerId: 'container-1',
      evidence: { reason: 'new-device-required' },
      reason: 'new_device_required',
      source: 'watchdog',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'recovery_suspended',
        eventSource: 'watchdog',
        eventStatus: 'blocked',
      }),
    );
  });

  it('blocks automatic recovery until a later successful connection exists', async () => {
    const repository = createRepository();
    repository.findOne.mockResolvedValue({
      createTime: new Date('2026-06-18T08:00:00.000Z'),
      eventKind: 'new_device_required',
    });
    const service = new NapcatLoginEventService(repository as any);

    await expect(
      service.canAttemptAutomaticRecovery({
        accountId: 'account-1',
        containerId: 'container-1',
        resetAfter: new Date('2026-06-18T07:59:00.000Z'),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'new_device_required',
    });
    await expect(
      service.canAttemptAutomaticRecovery({
        accountId: 'account-1',
        containerId: 'container-1',
        resetAfter: new Date('2026-06-18T08:01:00.000Z'),
      }),
    ).resolves.toEqual({ allowed: true });
  });
});

describe('NapCat watchdog auto-login boundaries', () => {
  it('does not call container auto-login when recovery is suspended', async () => {
    const accountNapcatRepository = {
      createQueryBuilder: jest.fn(() =>
        createManyQueryBuilder([
          {
            accountId: 'account-1',
            bindStatus: 'bound',
            containerId: 'container-1',
            isPrimary: true,
          },
        ]),
      ),
    };
    const containerRepository = {
      createQueryBuilder: jest.fn(() =>
        createManyQueryBuilder([
          {
            id: 'container-1',
            lastCheckedAt: new Date(),
            lastError: '账号状态变更为离线',
            name: 'kt-qqbot-napcat-10001',
            status: 'running',
          },
        ]),
      ),
    };
    const containerService = {
      detectRuntimeOffline: jest.fn(),
      tryAutoLogin: jest.fn(),
    };
    const loginEventService = {
      canAttemptAutomaticRecovery: jest.fn().mockResolvedValue({
        allowed: false,
        reason: 'recovery_suspended',
      }),
      recordSuspended: jest.fn(),
    };
    const service = new QqbotNapcatAccountRuntimeService(
      accountNapcatRepository as any,
      containerRepository as any,
      containerService as any,
      new ToolsService(),
      undefined,
      loginEventService as any,
    );

    await service.appendRuntime(
      [
        {
          connectStatus: 'online',
          id: 'account-1',
          lastConnectedAt: new Date('2026-06-18T00:00:00.000Z'),
          selfId: '10001',
        } as any,
      ],
      { autoLogin: true },
      {
        clearQqLoginError: jest.fn(),
        getLoginPassword: jest.fn(),
        markOnline: jest.fn(),
        markQqLoginOffline: jest.fn(),
        publishOfflineNotice: jest.fn(),
      },
    );

    expect(containerService.tryAutoLogin).not.toHaveBeenCalled();
    expect(loginEventService.recordSuspended).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        containerId: 'container-1',
        reason: 'recovery_suspended',
        source: 'watchdog',
      }),
    );
  });

  it('does not create a manual QR session from watchdog auto-login', async () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.getManagedMode = jest.fn().mockReturnValue('ssh');
    service.findContainerWithToken = jest.fn().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      name: 'kt-qqbot-napcat-10001',
    });
    service.ensureRuntimeLoginEnv = jest.fn().mockResolvedValue({
      changed: false,
      ok: true,
    });
    service.restartAndDetectLoginState = jest
      .fn()
      .mockResolvedValue({ offlineReason: '历史会话失效', state: 'offline' });

    const result = await service.tryAutoLogin(
      { id: 'container-1', name: 'kt-qqbot-napcat-10001' },
      { selfId: '10001' },
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(service.runProcess?.mock?.calls || [])).not.toContain(
      'qrcode',
    );
  });

  it('records password auto-login failure as suspended recovery', async () => {
    const loginEventService = {
      record: jest.fn(),
      recordSuspended: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
      {} as any,
      new ToolsService(),
      undefined,
      undefined,
      undefined,
      loginEventService as any,
    ) as any;
    service.getManagedMode = jest.fn().mockReturnValue('ssh');
    service.findContainerWithToken = jest.fn().mockResolvedValue({
      accountId: 'account-1',
      baseUrl: 'http://127.0.0.1:6100/',
      id: 'container-1',
      name: 'kt-qqbot-napcat-10001',
    });
    service.ensureRuntimeLoginEnv = jest
      .fn()
      .mockResolvedValueOnce({ changed: false, ok: true })
      .mockResolvedValueOnce({ changed: true, ok: true })
      .mockResolvedValueOnce({ changed: true, ok: true });
    service.restartAndDetectLoginState = jest
      .fn()
      .mockResolvedValueOnce({
        offlineReason: '历史会话失效',
        state: 'offline',
      })
      .mockResolvedValueOnce({
        offlineReason: '密码登录失败',
        state: 'offline',
      });

    const result = await service.tryAutoLogin(
      { accountId: 'account-1', id: 'container-1' } as any,
      {
        loginPassword: 'qq-password',
        selfId: '10001',
      },
    );

    expect(result).toEqual({ success: false });
    expect(loginEventService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'password_attempt',
        eventStatus: 'failed',
      }),
    );
    expect(loginEventService.recordSuspended).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        containerId: 'container-1',
        reason: 'recovery_suspended',
        source: 'watchdog',
      }),
    );
  });
});
