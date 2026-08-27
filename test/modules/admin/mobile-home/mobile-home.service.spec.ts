import { MobileHomeService } from '../../../../src/modules/admin/platform-config/mobile-home/application/mobile-home.service';

const dashboard = {
  actions: [],
  events: [],
  generatedAt: '2026-08-27T06:00:00.000Z',
  refreshedAt: '2026-08-27T06:00:00.000Z',
  sites: [],
  summary: { byStatus: {}, totalSignals: 0 },
  topology: { edges: [], nodes: [] },
};

const notice = {
  content: '环境状态已更新',
  createTime: new Date(2026, 7, 27, 14, 0, 0),
  dedupeKey: 'internal-only',
  eventType: 'environment.changed',
  id: '2041700000000300001',
  isDeleted: false,
  isTop: true,
  lastSeenAt: new Date(2026, 7, 27, 14, 1, 0),
  level: 2,
  metadata: { internal: true },
  notifyRoleCode: 'super',
  notifyUsers: '100001',
  occurrenceCount: 2,
  severity: 'warn',
  source: 'environment-dashboard',
  status: 1,
  summary: '一项环境信号发生变化',
  title: '环境提醒',
};

describe('MobileHomeService', () => {
  const environment = {
    getDashboard: jest.fn(),
  };
  const notices = {
    getUnreadCount: jest.fn(),
    page: jest.fn(),
  };
  const service = new MobileHomeService(environment as any, notices as any);

  beforeEach(() => {
    jest.clearAllMocks();
    environment.getDashboard.mockResolvedValue(dashboard);
    notices.page.mockResolvedValue({ items: [notice], total: 1 });
    notices.getUnreadCount.mockResolvedValue(3);
  });

  it('aggregates the authoritative environment and notice sources into one mobile snapshot', async () => {
    const result = await service.getBootstrap();

    expect(environment.getDashboard).toHaveBeenCalledTimes(1);
    expect(notices.page).toHaveBeenCalledWith({ pageNo: 1, pageSize: 40 });
    expect(notices.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      environment: dashboard,
      notices: {
        items: [
          {
            content: notice.content,
            createTime: notice.createTime,
            eventType: notice.eventType,
            id: notice.id,
            isTop: notice.isTop,
            lastSeenAt: notice.lastSeenAt,
            occurrenceCount: notice.occurrenceCount,
            severity: notice.severity,
            source: notice.source,
            status: notice.status,
            summary: notice.summary,
            title: notice.title,
          },
        ],
        total: 1,
        unreadCount: 3,
      },
    });
    expect(result.notices.items[0]).not.toHaveProperty('dedupeKey');
    expect(result.notices.items[0]).not.toHaveProperty('metadata');
    expect(result.notices.items[0]).not.toHaveProperty('notifyUsers');
  });

  it('fails the whole snapshot when one authoritative source fails', async () => {
    environment.getDashboard.mockRejectedValueOnce(
      new Error('environment unavailable'),
    );

    await expect(service.getBootstrap()).rejects.toThrow(
      'environment unavailable',
    );
  });
});
