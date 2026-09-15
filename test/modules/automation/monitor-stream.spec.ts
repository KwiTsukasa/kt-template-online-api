import { firstValueFrom } from 'rxjs';
import { AutomationMonitorService } from '@/modules/automation-monitor/application/automation-monitor.service';
import type { RunSummary } from '@/common/automation/run-feed';

const settle = setImmediate;
const advance = async (milliseconds: number) => {
  jest.advanceTimersByTime(milliseconds);
  await new Promise<void>((resolve) => settle(resolve));
};

describe('execution monitor snapshot stream', () => {
  afterEach(() => jest.useRealTimers());

  it('emits changes, resnapshots on reconnect and stops polling after unsubscribe', async () => {
    jest.useFakeTimers();
    const records: RunSummary[] = [];
    const port = { page: jest.fn(async () => records) };
    const monitor = new AutomationMonitorService(port, { page: async () => [] }, { page: async () => [] });
    const events: any[] = [];
    const subscription = monitor.stream({ limit: 30 }).subscribe((event) => events.push(event));
    await advance(0);
    expect(events).toHaveLength(1);
    await advance(2_000);
    expect(events).toHaveLength(1);
    records.push({ kind: 'task', runId: '2099902999953543168', resourceId: '100', resourceVersion: 1,
      name: '任务', phase: 'active', status: 'running', createdAt: new Date(), finishedAt: null,
      requiresReview: false, hasError: false });
    await advance(2_000);
    expect(events).toHaveLength(2);
    expect(events[1].id).not.toBe(events[0].id);
    subscription.unsubscribe();
    const reads = port.page.mock.calls.length;
    await advance(30_000);
    expect(port.page).toHaveBeenCalledTimes(reads);
    const replay = await firstValueFrom(monitor.stream({ limit: 30 }));
    expect(replay).toEqual(events[1]);
    await advance(5_000);
    expect(port.page).toHaveBeenCalledTimes(reads + 1);
  });

  it('propagates a failed source instead of publishing an empty successful snapshot', async () => {
    const failure = new Error('source unavailable');
    const monitor = new AutomationMonitorService({ page: async () => { throw failure; } },
      { page: async () => [] }, { page: async () => [] });
    await expect(firstValueFrom(monitor.stream({}))).rejects.toBe(failure);
  });
});
