import { NapcatWatchdogService } from '@/modules/bot-adapter/napcat/application/login/napcat-watchdog.service';

describe('NapcatWatchdogService domain inspection', () => {
  it('does not own a timer and runs only when its public capability is invoked', async () => {
    jest.useFakeTimers();
    try {
      const handler = jest.fn().mockResolvedValue({ checked: 1 });
      const service = new NapcatWatchdogService({
        runOfflineWatchdog: handler,
      } as any);
      jest.advanceTimersByTime(300000);
      expect(handler).not.toHaveBeenCalled();
      await service.inspectOffline();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips overlapping calls and permits another inspection after completion', async () => {
    let finish!: () => void;
    const handler = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const service = new NapcatWatchdogService({
      runOfflineWatchdog: handler,
    } as any);
    const pending = service.inspectOffline();
    await service.inspectOffline();
    expect(handler).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    handler.mockResolvedValueOnce(undefined);
    await service.inspectOffline();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('returns domain failures to its caller and releases the running guard', async () => {
    const handler = jest
      .fn()
      .mockRejectedValueOnce(new Error('巡检失败'))
      .mockResolvedValue(undefined);
    const service = new NapcatWatchdogService({
      runOfflineWatchdog: handler,
    } as any);
    await expect(service.inspectOffline()).rejects.toThrow('巡检失败');
    await service.inspectOffline();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
