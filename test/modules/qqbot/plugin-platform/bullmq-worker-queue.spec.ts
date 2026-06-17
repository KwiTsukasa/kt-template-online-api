const mockBullmqCreations: Array<{
  name: string;
  options: { prefix?: string };
  type: 'Queue' | 'QueueEvents' | 'Worker';
}> = [];

jest.mock('bullmq', () => {
  class MockQueue {
    /**
     * 初始化 MockQueue 实例。
     * @param name - 名称文本；计算 插件平台布尔判断。
     * @param options - 插件平台列表；影响 constructor 的返回值。
     */
    constructor(name: string, options: { prefix?: string }) {
      if (name.includes(':')) {
        throw new Error('Queue name cannot contain :');
      }
      mockBullmqCreations.push({ name, options, type: 'Queue' });
    }

    /**
     * 处理业务数据。
     */
    on() {
      return this;
    }

    /**
     * 执行 QQBot 插件平台流程。
     */
    waitUntilReady() {
      return Promise.resolve();
    }

    /**
     * 执行 QQBot 插件平台流程。
     */
    close() {
      return Promise.resolve();
    }
  }

  class MockQueueEvents extends MockQueue {
    /**
     * 初始化 MockQueueEvents 实例。
     * @param name - 名称文本；驱动 `super()` 的 插件平台步骤。
     * @param options - 插件平台列表；驱动 `super()` 的 插件平台步骤。
     */
    constructor(name: string, options: { prefix?: string }) {
      super(name, options);
      mockBullmqCreations[mockBullmqCreations.length - 1].type = 'QueueEvents';
    }
  }

  class MockWorker extends MockQueue {
    /**
     * 初始化 MockWorker 实例。
     * @param name - 名称文本；驱动 `super()` 的 插件平台步骤。
     * @param _processor - _processor 输入；影响 constructor 的返回值。
     * @param options - 插件平台列表；驱动 `super()` 的 插件平台步骤。
     */
    constructor(
      name: string,
      _processor: unknown,
      options: { prefix?: string },
    ) {
      super(name, options);
      mockBullmqCreations[mockBullmqCreations.length - 1].type = 'Worker';
    }
  }

  return {
    Job: class MockJob {},
    Queue: MockQueue,
    QueueEvents: MockQueueEvents,
    Worker: MockWorker,
  };
});

import { QqbotBullmqPluginWorkerRequestQueue } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/runtime';
import type { QqbotPluginWorkerDriver } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/runtime';

describe('QQBot BullMQ plugin worker request queue', () => {
  beforeEach(() => {
    mockBullmqCreations.length = 0;
  });

  it('keeps Redis prefix separate from a colon-free BullMQ queue name', async () => {
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async () => ({ ok: true })),
    };

    const queue = new QqbotBullmqPluginWorkerRequestQueue(driver, {
      connection: {
        host: 'redis.local',
        port: 6379,
      },
      installationId: 'install:1',
      pluginKey: 'bang:dream',
      prefix: 'kt:qqbot:plugin-worker',
      queueWaitTimeoutMs: 120_000,
      removeOnFailCount: 100,
      waitUntilFinishedBufferMs: 5_000,
      workerInstanceId: 'worker-1',
    });

    await queue.close();

    expect(mockBullmqCreations).toHaveLength(3);
    expect(mockBullmqCreations.map((creation) => creation.name)).toEqual([
      'qqbot-plugin-worker-bang-dream-install-1',
      'qqbot-plugin-worker-bang-dream-install-1',
      'qqbot-plugin-worker-bang-dream-install-1',
    ]);
    expect(
      mockBullmqCreations.every((creation) => !creation.name.includes(':')),
    ).toBe(true);
    expect(
      mockBullmqCreations.every(
        (creation) => creation.options.prefix === 'kt:qqbot:plugin-worker',
      ),
    ).toBe(true);
    expect(queue.handlesRequestTimeout).toBe(true);
    expect(queue.queueWaitTimeoutMs).toBe(120_000);
  });
});
