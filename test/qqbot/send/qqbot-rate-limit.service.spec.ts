import { QqbotRateLimitService } from '@/modules/qqbot/core/application/send/qqbot-rate-limit.service';

/**
 * 创建 测试断言对象或配置。
 * @param config - config 输入；构造 Jest mock 返回值。
 */
function createService(config: Record<string, number | string | undefined>) {
  return new QqbotRateLimitService({
    get: jest.fn((key: string) => config[key]),
  } as any);
}

describe('QqbotRateLimitService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queues a repeated target send instead of rejecting it immediately', async () => {
    const service = createService({
      QQBOT_SEND_GLOBAL_INTERVAL_MS: 1000,
      QQBOT_SEND_JITTER_MS: 0,
      QQBOT_SEND_MAX_QUEUE_WAIT_MS: 10000,
      QQBOT_SEND_TARGET_INTERVAL_MS: 3000,
    });

    await expect(
      (service as any).waitForSendSlot('bot-1', 'group-1'),
    ).resolves.toEqual({ waitMs: 0 });

    const secondSend = (service as any).waitForSendSlot('bot-1', 'group-1');

    jest.advanceTimersByTime(2999);
    await Promise.resolve();
    await expect(
      Promise.race([secondSend, Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await expect(secondSend).resolves.toEqual({ waitMs: 3000 });
  });

  it('rejects when the queued send would wait beyond the configured budget', async () => {
    const service = createService({
      QQBOT_SEND_GLOBAL_INTERVAL_MS: 1000,
      QQBOT_SEND_JITTER_MS: 0,
      QQBOT_SEND_MAX_QUEUE_WAIT_MS: 1000,
      QQBOT_SEND_TARGET_INTERVAL_MS: 3000,
    });

    await (service as any).waitForSendSlot('bot-1', 'group-1');

    await expect(
      (service as any).waitForSendSlot('bot-1', 'group-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'QQBot 发送队列繁忙，请稍后再试',
      }),
    });
  });

  it('does not reserve a slot for a rejected queued send', async () => {
    const service = createService({
      QQBOT_SEND_GLOBAL_INTERVAL_MS: 1000,
      QQBOT_SEND_JITTER_MS: 0,
      QQBOT_SEND_MAX_QUEUE_WAIT_MS: 1000,
      QQBOT_SEND_TARGET_INTERVAL_MS: 3000,
    });

    await (service as any).waitForSendSlot('bot-1', 'group-1');

    await expect(
      (service as any).waitForSendSlot('bot-1', 'group-1'),
    ).rejects.toBeDefined();

    jest.advanceTimersByTime(3000);

    await expect(
      (service as any).waitForSendSlot('bot-1', 'group-1'),
    ).resolves.toEqual({ waitMs: 0 });
  });

  it('does not let one target queue block another target global slot', async () => {
    const service = createService({
      QQBOT_SEND_GLOBAL_INTERVAL_MS: 1000,
      QQBOT_SEND_JITTER_MS: 0,
      QQBOT_SEND_MAX_QUEUE_WAIT_MS: 10000,
      QQBOT_SEND_TARGET_INTERVAL_MS: 3000,
    });

    await (service as any).waitForSendSlot('bot-1', 'group-1');

    const sameTargetSend = (service as any).waitForSendSlot('bot-1', 'group-1');
    const otherTargetSend = (service as any).waitForSendSlot(
      'bot-1',
      'group-2',
    );

    jest.advanceTimersByTime(999);
    await Promise.resolve();
    await expect(
      Promise.race([otherTargetSend, Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await expect(otherTargetSend).resolves.toEqual({ waitMs: 1000 });

    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    await expect(sameTargetSend).resolves.toEqual({ waitMs: 3000 });
  });
});
