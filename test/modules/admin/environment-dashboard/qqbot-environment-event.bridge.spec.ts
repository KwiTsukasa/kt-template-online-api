import { QqbotEnvironmentEventBridge } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/event/qqbot-environment-event.bridge';

describe('qqbot environment event bridge', () => {
  it('maps NapCat runtime events into dashboard environment envelopes', async () => {
    const bus = { publish: jest.fn() };
    const bridge = new QqbotEnvironmentEventBridge(bus);

    await bridge.publishNapcatRuntimeEvent({
      accountId: 'account-1',
      message: 'NapCat offline',
      observedAt: '2026-06-18T01:00:00.000Z',
      selfId: '1914728559',
      severity: 'down',
    });

    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'nas-prod-qqbot',
        serviceId: 'napcat',
        severity: 'down',
        signalId: 'napcat-1914728559',
        siteId: 'nas-prod',
        sourceKind: 'local',
      }),
    );
  });

  it('maps plugin task runs without depending on QQBot topic constants', async () => {
    const bus = { publish: jest.fn() };
    const bridge = new QqbotEnvironmentEventBridge(bus);

    await bridge.publishPluginTaskRun({
      message: 'Bestdori sync disabled',
      observedAt: '2026-06-18T01:00:00.000Z',
      pluginKey: 'bangdream',
      severity: 'degraded',
      taskKey: 'bestdori-sync',
    });

    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'plugin-tasks',
        signalId: 'plugin-task-bangdream-bestdori-sync',
        topic: 'kt/env/qqbot/plugin-task/bangdream/bestdori-sync/run',
      }),
    );
  });
});
