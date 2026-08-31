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
  const homeAssistant = {
    assist: jest.fn(),
    callService: jest.fn(),
    history: jest.fn(),
    snapshot: jest.fn(),
  };
  const sunshine = {
    apps: jest.fn(),
    displayResolution: jest.fn(),
    host: jest.fn(),
    httpsPort: jest.fn(),
    streamPort: jest.fn(),
    submitPin: jest.fn(),
    vigemStatus: jest.fn(),
  };
  const service = new MobileHomeService(
    environment as any,
    notices as any,
    homeAssistant as any,
    sunshine as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    environment.getDashboard.mockResolvedValue(dashboard);
    notices.page.mockResolvedValue({ items: [notice], total: 1 });
    notices.getUnreadCount.mockResolvedValue(3);
    homeAssistant.snapshot.mockResolvedValue({
      areas: [],
      devices: [],
      entities: [],
      logbook: [],
      states: [],
    });
    homeAssistant.history.mockResolvedValue([]);
    sunshine.apps.mockResolvedValue({ apps: [] });
    sunshine.displayResolution.mockResolvedValue('2560x1600');
    sunshine.host.mockReturnValue('10.66.66.4');
    sunshine.httpsPort.mockReturnValue(38994);
    sunshine.streamPort.mockReturnValue(38999);
    sunshine.vigemStatus.mockResolvedValue({
      installed: true,
      version: '1.21.442',
      version_compatible: true,
    });
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

  it('projects Home Assistant registries, typed attributes, activity, scenes and real energy history', async () => {
    homeAssistant.snapshot.mockResolvedValueOnce({
      areas: [
        { area_id: 'living-room', floor_id: 'floor-1', name: 'Living Room' },
      ],
      devices: [{ area_id: 'living-room', id: 'device-light' }],
      entities: [
        {
          device_id: 'device-light',
          entity_id: 'light.living_room',
          original_name: 'Living Room Light',
        },
      ],
      logbook: [
        {
          entity_id: 'lock.front_door',
          message: '已上锁',
          name: '入户门',
          when: '2026-08-31T10:00:00.000Z',
        },
        {
          entity_id: 'sensor.sun_next_midnight',
          name: 'Sun Next midnight',
          state: '2026-09-01T00:00:01+00:00',
          when: '2026-08-31T08:00:00.000Z',
        },
      ],
      states: [
        {
          attributes: {
            brightness: 200,
            friendly_name: '客厅主灯',
            secret_internal: 'must-not-project',
          },
          entity_id: 'light.living_room',
          last_updated: '2026-08-31T10:00:00.000Z',
          state: 'on',
        },
        {
          attributes: {
            device_class: 'energy',
            friendly_name: '今日用电',
            unit_of_measurement: 'kWh',
          },
          entity_id: 'sensor.daily_energy',
          last_updated: '2026-08-31T10:00:00.000Z',
          state: '12.7',
        },
        {
          attributes: { friendly_name: '观影模式' },
          entity_id: 'scene.movie',
          last_changed: '2026-08-31T09:00:00.000Z',
          state: 'scening',
        },
        {
          attributes: { friendly_name: 'Backup Backup Manager state' },
          entity_id: 'sensor.backup_backup_manager_state',
          state: 'idle',
        },
      ],
    });
    homeAssistant.history.mockResolvedValueOnce([
      [
        {
          entity_id: 'sensor.daily_energy',
          last_updated: '2026-08-31T09:00:00.000Z',
          state: '11.4',
        },
      ],
    ]);

    const result = await service.getHomeSnapshot();

    expect(result.connected).toBe(true);
    expect(result.areas).toEqual([
      { entityCount: 1, floorId: 'floor-1', id: 'living-room', name: '客厅' },
    ]);
    expect(result.entities[0]).toMatchObject({
      areaId: 'living-room',
      domain: 'light',
      entityId: 'light.living_room',
      name: '客厅主灯',
      state: 'on',
    });
    expect(result.entities[0].attributes).not.toEqual(
      expect.arrayContaining([
        { key: 'secret_internal', value: expect.anything() },
      ]),
    );
    expect(result.scenes).toEqual([
      expect.objectContaining({
        domain: 'scene',
        entityId: 'scene.movie',
        name: '观影模式',
      }),
    ]);
    expect(result.activities[0]).toMatchObject({ severity: 'success' });
    expect(result.activities[1].summary).toBe('下次午夜');
    expect(
      result.entities.find(
        (entity) => entity.entityId === 'sensor.backup_backup_manager_state',
      )?.name,
    ).toBe('备份管理器状态');
    expect(result.energy[0]).toMatchObject({
      entityId: 'sensor.daily_energy',
      points: [{ observedAt: '2026-08-31T09:00:00.000Z', value: 11.4 }],
      state: 12.7,
      unit: 'kWh',
    });
  });

  it('executes an allowlisted Home Assistant write once for one requestId', async () => {
    homeAssistant.callService.mockResolvedValueOnce([
      {
        attributes: { friendly_name: '客厅主灯' },
        entity_id: 'light.living_room',
        state: 'on',
      },
    ]);
    const input = {
      data: { brightness: 180 },
      domain: 'light',
      entityId: 'light.living_room',
      requestId: 'request-light-0001',
      service: 'turn_on',
    };

    const first = await service.callHomeService(input);
    const second = await service.callHomeService(input);

    expect(first).toEqual(second);
    expect(homeAssistant.callService).toHaveBeenCalledTimes(1);
    expect(homeAssistant.callService).toHaveBeenCalledWith({
      data: { brightness: 180, entity_id: 'light.living_room' },
      domain: 'light',
      service: 'turn_on',
    });
  });

  it('projects Assist speech without returning raw cards or data', async () => {
    homeAssistant.assist.mockResolvedValueOnce({
      continue_conversation: false,
      conversation_id: 'conversation-1',
      response: {
        card: { title: 'internal' },
        data: { success: ['light.living_room'] },
        response_type: 'action_done',
        speech: { plain: { speech: '已打开客厅主灯' } },
      },
    });

    await expect(service.assist({ text: '打开客厅主灯' })).resolves.toEqual({
      continueConversation: false,
      conversationId: 'conversation-1',
      responseType: 'action_done',
      speech: '已打开客厅主灯',
    });
  });

  it('returns the real Sunshine catalog without local image paths and forwards a valid PIN', async () => {
    sunshine.apps.mockResolvedValueOnce({
      apps: [
        {
          name: 'Steam Big Picture',
          uuid: 'app-1',
          'image-path': 'C:\\covers\\steam.png',
        },
        {
          name: 'Desktop',
          uuid: 'app-2',
          'image-path': 'https://example.invalid/desktop.png',
        },
      ],
    });
    sunshine.submitPin.mockResolvedValueOnce(true);

    await expect(service.getGameSnapshot()).resolves.toEqual({
      apps: [
        { id: 'app-1', name: 'Steam Big Picture' },
        {
          id: 'app-2',
          imagePath: 'https://example.invalid/desktop.png',
          name: 'Desktop',
        },
      ],
      displayResolution: '2560x1600',
      generatedAt: expect.any(String),
      host: '10.66.66.4',
      httpsPort: 38994,
      managementReady: true,
      streamPort: 38999,
      virtualGamepadReady: true,
    });
    await expect(service.submitGamePin('1234', 'KwiCore')).resolves.toEqual({
      accepted: true,
    });
  });
});
