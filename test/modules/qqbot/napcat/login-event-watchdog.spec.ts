import { ToolsService } from '@/common';
import { QqbotNapcatAccountRuntimeService } from '../../../../src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service';

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

describe('NapCat watchdog notification boundaries', () => {
  it('does not call container auto-login when watchdog detects QQ login offline', async () => {
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
            lastCheckedAt: null,
            lastError: null,
            name: 'kt-qqbot-napcat-10001',
            status: 'running',
          },
        ]),
      ),
    };
    const containerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
    };
    const service = new QqbotNapcatAccountRuntimeService(
      accountNapcatRepository as any,
      containerRepository as any,
      containerService as any,
      new ToolsService(),
    );
    const actions = {
      clearQqLoginError: jest.fn(),
      markQqLoginOffline: jest.fn(),
      publishOfflineNotice: jest.fn(),
    };

    await service.appendRuntime(
      [
        {
          connectStatus: 'online',
          id: 'account-1',
          lastConnectedAt: new Date('2026-06-18T00:00:00.000Z'),
          selfId: '10001',
        } as any,
      ],
      actions as any,
    );

    expect(actions.markQqLoginOffline).toHaveBeenCalledWith(
      '10001',
      'NapCat 账号状态变更为离线',
    );
    expect(actions.publishOfflineNotice).toHaveBeenCalledWith(
      '10001',
      'NapCat 账号状态变更为离线',
      expect.objectContaining({
        containerId: 'container-1',
        containerName: 'kt-qqbot-napcat-10001',
      }),
    );
  });
});
