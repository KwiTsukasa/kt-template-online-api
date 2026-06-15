import { AdminNoticeService } from '@/modules/admin/platform-config/notice/admin-notice.service';
import { ToolsService } from '@/common';

function createRepositoryMock(overrides: Record<string, jest.Mock> = {}) {
  const repository = {
    createQueryBuilder: jest.fn(),
    create: jest.fn((entity) => entity),
    findOne: jest.fn().mockResolvedValue(null),
    merge: jest.fn((target, input) => ({ ...target, ...input })),
    save: jest.fn(async (entity) => ({
      id: entity.id || 'notice-1',
      ...entity,
    })),
    update: jest.fn(),
    ...overrides,
  };

  return repository;
}

describe('AdminNoticeService system event notices', () => {
  it('publishes API errors as unread super role notices', async () => {
    const repository = createRepositoryMock();
    const service = new AdminNoticeService(
      repository as any,
      new ToolsService(),
    );

    const id = await (service as any).publishSystemNotice({
      content: 'Error: boom',
      dedupeKey: 'api:error:GET:/boom:500',
      eventType: 'api.error',
      metadata: {
        method: 'GET',
        path: '/boom',
        requestId: 'req-1',
        statusCode: 500,
      },
      severity: 'error',
      source: 'api',
      summary: '500 GET /boom',
      title: '接口错误：GET /boom',
    });

    expect(id).toBe('notice-1');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Error: boom',
        dedupeKey: 'api:error:GET:/boom:500',
        eventType: 'api.error',
        level: 3,
        metadata: expect.objectContaining({
          method: 'GET',
          path: '/boom',
          requestId: 'req-1',
          statusCode: 500,
        }),
        notifyRoleCode: 'super',
        occurrenceCount: 1,
        severity: 'error',
        source: 'api',
        status: 1,
        summary: '500 GET /boom',
        title: '接口错误：GET /boom',
      }),
    );
  });

  it('bounds long system notice title and dedupe key to database column sizes', async () => {
    const repository = createRepositoryMock();
    const service = new AdminNoticeService(
      repository as any,
      new ToolsService(),
    );
    const longPath = `/system/${'very-long-path-'.repeat(40)}`;

    await (service as any).publishSystemNotice({
      content: 'database unavailable',
      dedupeKey: `api:error:POST:${longPath}:500`,
      eventType: 'api.error',
      severity: 'error',
      source: 'api',
      summary: `500 POST ${longPath}`,
      title: `接口错误：POST ${longPath}`,
    });

    const notice = repository.create.mock.calls[0][0];
    expect(notice.dedupeKey).toHaveLength(255);
    expect(notice.title.length).toBeLessThanOrEqual(255);
    expect(notice.dedupeKey).toMatch(/#[a-f0-9]{12}$/);
  });

  it('aggregates repeated events by dedupe key instead of creating noise', async () => {
    const existingNotice = {
      content: 'old',
      dedupeKey: 'qqbot:offline:1914728559',
      id: 'notice-1',
      isDeleted: false,
      occurrenceCount: 2,
      status: 0,
      summary: 'old',
      title: 'old',
    };
    const repository = createRepositoryMock({
      findOne: jest.fn().mockResolvedValue(existingNotice),
    });
    const updateBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
      set: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    repository.createQueryBuilder.mockReturnValue(updateBuilder);
    const service = new AdminNoticeService(
      repository as any,
      new ToolsService(),
    );

    const id = await (service as any).publishSystemNotice({
      content: 'bot_offline/kick_offline：账号已在另一台终端登录',
      dedupeKey: 'qqbot:offline:1914728559',
      eventType: 'qqbot.account.offline',
      metadata: {
        selfId: '1914728559',
      },
      severity: 'error',
      source: 'qqbot',
      summary: '账号已在另一台终端登录',
      title: 'QQBot 账号已下线：1914728559',
    });

    expect(id).toBe('notice-1');
    expect(repository.create).not.toHaveBeenCalled();
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'bot_offline/kick_offline：账号已在另一台终端登录',
        metadata: expect.objectContaining({
          selfId: '1914728559',
        }),
        occurrenceCount: expect.any(Function),
        severity: 'error',
        status: 1,
        summary: '账号已在另一台终端登录',
        title: 'QQBot 账号已下线：1914728559',
      }),
    );
    expect(updateBuilder.where).toHaveBeenCalledWith('id = :id', {
      id: 'notice-1',
    });
    expect(updateBuilder.execute).toHaveBeenCalled();
  });

  it('aggregates when a concurrent insert hits the dedupe unique key', async () => {
    const duplicateError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
    });
    const repository = createRepositoryMock({
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        dedupeKey: 'api:error:GET:/boom:500',
        id: 'notice-1',
        isDeleted: false,
        occurrenceCount: 1,
      }),
      save: jest.fn().mockRejectedValueOnce(duplicateError),
    });
    const updateBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
      set: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    repository.createQueryBuilder.mockReturnValue(updateBuilder);
    const service = new AdminNoticeService(
      repository as any,
      new ToolsService(),
    );

    const id = await (service as any).publishSystemNotice({
      content: 'Error: boom',
      dedupeKey: 'api:error:GET:/boom:500',
      eventType: 'api.error',
      severity: 'error',
      source: 'api',
      summary: '500 GET /boom',
      title: '接口错误：GET /boom',
    });

    expect(id).toBe('notice-1');
    expect(repository.findOne).toHaveBeenCalledTimes(2);
    expect(updateBuilder.execute).toHaveBeenCalled();
  });

  it('orders event notices by the latest occurrence time', async () => {
    const builder = {
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const repository = createRepositoryMock({
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    });
    const service = new AdminNoticeService(
      repository as any,
      new ToolsService(),
    );

    await service.page({});

    expect(builder.orderBy).toHaveBeenCalledWith('notice.isTop', 'DESC');
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(
      1,
      'notice.lastSeenAt',
      'DESC',
    );
    expect(builder.addOrderBy).toHaveBeenNthCalledWith(
      2,
      'notice.createTime',
      'DESC',
    );
  });
});
