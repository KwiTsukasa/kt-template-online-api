import { ConfigService } from '@nestjs/config';
import { QqbotNapcatWatchdogService } from '@/modules/qqbot/napcat/login/qqbot-napcat-watchdog.service';

function buildService(
  configValues: Record<string, string | undefined>,
  runOfflineWatchdog: jest.Mock,
) {
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const accountService = { runOfflineWatchdog } as any;
  return new QqbotNapcatWatchdogService(configService, accountService);
}

// 刷新微任务队列，让定时器回调里的 async tick（含 finally 复位 running）执行完。
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('QqbotNapcatWatchdogService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('periodically triggers the offline watchdog when enabled', async () => {
    jest.useFakeTimers();
    const runOfflineWatchdog = jest.fn().mockResolvedValue({ checked: 1 });
    const service = buildService(
      { QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS: '30000' },
      runOfflineWatchdog,
    );

    service.onModuleInit();
    expect(runOfflineWatchdog).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30000);
    await flushMicrotasks();
    expect(runOfflineWatchdog).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30000);
    await flushMicrotasks();
    expect(runOfflineWatchdog).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(60000);
    await flushMicrotasks();
    expect(runOfflineWatchdog).toHaveBeenCalledTimes(2);
  });

  it('does not start a timer when disabled', async () => {
    jest.useFakeTimers();
    const runOfflineWatchdog = jest.fn().mockResolvedValue({ checked: 0 });
    const service = buildService(
      { QQBOT_NAPCAT_WATCHDOG_ENABLED: 'false' },
      runOfflineWatchdog,
    );

    service.onModuleInit();
    jest.advanceTimersByTime(600000);
    await flushMicrotasks();
    expect(runOfflineWatchdog).not.toHaveBeenCalled();
  });

  it('clamps an unreasonably small interval to the safe default', () => {
    const service = buildService(
      { QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS: '1000' },
      jest.fn(),
    ) as any;
    expect(service.getIntervalMs()).toBe(120_000);
  });

  it('skips overlapping ticks while a previous run is still pending', async () => {
    jest.useFakeTimers();
    let resolvePending: (() => void) | undefined;
    const runOfflineWatchdog = jest.fn(
      () =>
        new Promise<{ checked: number }>((resolve) => {
          resolvePending = () => resolve({ checked: 1 });
        }),
    );
    const service = buildService(
      { QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS: '30000' },
      runOfflineWatchdog,
    );

    service.onModuleInit();
    jest.advanceTimersByTime(30000); // first tick starts, stays pending
    await flushMicrotasks();
    jest.advanceTimersByTime(30000); // second tick should be skipped
    await flushMicrotasks();
    expect(runOfflineWatchdog).toHaveBeenCalledTimes(1);

    resolvePending?.();
    await flushMicrotasks();

    jest.advanceTimersByTime(30000); // running reset, a new tick can run
    await flushMicrotasks();
    expect(runOfflineWatchdog).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });
});
