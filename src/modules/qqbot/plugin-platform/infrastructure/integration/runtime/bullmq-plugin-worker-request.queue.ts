import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  Job,
  Queue,
  QueueEvents,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
} from 'bullmq';
import {
  QqbotPluginWorkerExpiredRequestError,
  QqbotPluginWorkerResponseError,
  QqbotPluginWorkerStaleRequestError,
  type QqbotPluginWorkerResponseErrorInput,
} from './worker-runtime';
import type {
  QqbotPluginWorkerDriver,
  QqbotPluginWorkerRequest,
  QqbotPluginWorkerRequestQueue,
} from './worker-runtime.types';

export type QqbotBullmqWorkerRequestQueueOptions = {
  connection: ConnectionOptions;
  installationId: string;
  pluginKey: string;
  prefix: string;
  queueWaitTimeoutMs: number;
  removeOnFailCount: number;
  waitUntilFinishedBufferMs: number;
  workerInstanceId: string;
};

type QqbotWorkerQueueJobData = {
  expiresAt: number;
  generation: number;
  message: QqbotPluginWorkerRequest;
  workerInstanceId: string;
};

type QqbotWorkerQueueResult =
  | {
      ok: true;
      result: unknown;
    }
  | {
      error: QqbotPluginWorkerResponseErrorInput;
      ok: false;
    };

export class QqbotBullmqPluginWorkerRequestQueue implements QqbotPluginWorkerRequestQueue {
  readonly handlesRequestTimeout = true;
  readonly queueWaitTimeoutMs: number;
  private readonly queue: Queue<
    QqbotWorkerQueueJobData,
    QqbotWorkerQueueResult,
    string
  >;
  private readonly queueEvents: QueueEvents;
  private readonly ready: Promise<unknown[]>;
  private readonly worker: Worker<
    QqbotWorkerQueueJobData,
    QqbotWorkerQueueResult,
    string
  >;
  private readonly logger = new Logger(
    QqbotBullmqPluginWorkerRequestQueue.name,
  );
  private closed = false;
  private generation = 0;

  constructor(
    private readonly driver: QqbotPluginWorkerDriver,
    private readonly options: QqbotBullmqWorkerRequestQueueOptions,
  ) {
    this.queueWaitTimeoutMs = options.queueWaitTimeoutMs;
    const queueName = buildWorkerQueueName(
      options.pluginKey,
      options.installationId,
    );
    const bullmqOptions = {
      connection: options.connection,
      prefix: options.prefix,
    };
    this.queue = new Queue(queueName, bullmqOptions);
    this.queueEvents = new QueueEvents(queueName, bullmqOptions);
    this.worker = new Worker(
      queueName,
      async (job: Job<QqbotWorkerQueueJobData>) => {
        if (job.data.expiresAt <= Date.now()) {
          return {
            error: {
              message: 'worker-request-expired',
              name: 'QqbotPluginWorkerExpiredRequestError',
            },
            ok: false,
          };
        }
        if (job.data.workerInstanceId !== this.options.workerInstanceId) {
          return {
            error: {
              message: 'worker-request-foreign-instance',
              name: 'QqbotPluginWorkerStaleRequestError',
            },
            ok: false,
          };
        }
        if (job.data.generation !== this.generation) {
          return {
            error: {
              message: 'worker-request-stale',
              name: 'QqbotPluginWorkerStaleRequestError',
            },
            ok: false,
          };
        }
        try {
          return {
            ok: true,
            result: await this.requestDriverWithTimeout(job.data.message),
          };
        } catch (error) {
          if (error instanceof QqbotPluginWorkerResponseError) {
            return {
              error: error.serializedError,
              ok: false,
            };
          }
          if (error instanceof QqbotPluginWorkerExpiredRequestError) {
            await this.reset();
            return {
              error: {
                message: error.message,
                name: error.name,
              },
              ok: false,
            };
          }
          await this.reset();
          throw error;
        }
      },
      {
        ...bullmqOptions,
        concurrency: 1,
      },
    );
    this.queue.on('error', (error) => {
      this.logBullmqError('queue', error);
    });
    this.queueEvents.on('error', (error) => {
      this.logBullmqError('queueEvents', error);
    });
    this.worker.on('error', (error) => {
      this.logBullmqError('worker', error);
    });
    this.ready = Promise.all([
      this.queue.waitUntilReady(),
      this.queueEvents.waitUntilReady(),
      this.worker.waitUntilReady(),
    ]);
  }

  async request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    if (this.closed) {
      throw new Error('QQBot 插件 worker 队列已关闭');
    }

    await this.ready;
    const job = await this.queue.add(
      message.type,
      {
        expiresAt:
          Date.now() +
          message.timeoutMs +
          this.options.queueWaitTimeoutMs +
          this.options.waitUntilFinishedBufferMs,
        generation: this.generation,
        message,
        workerInstanceId: this.options.workerInstanceId,
      },
      {
        attempts: 1,
        jobId: message.correlationId,
        removeOnComplete: true,
        removeOnFail: this.options.removeOnFailCount,
      } satisfies JobsOptions,
    );
    const result = await job.waitUntilFinished(
      this.queueEvents,
      message.timeoutMs +
        this.options.queueWaitTimeoutMs +
        this.options.waitUntilFinishedBufferMs,
    );

    if (result?.ok === false) {
      if (result.error.name === 'QqbotPluginWorkerStaleRequestError') {
        throw new QqbotPluginWorkerStaleRequestError(result.error.message);
      }
      if (result.error.name === 'QqbotPluginWorkerExpiredRequestError') {
        throw new QqbotPluginWorkerExpiredRequestError(result.error.message);
      }
      throw new QqbotPluginWorkerResponseError(result.error);
    }
    return result?.result;
  }

  async reset(): Promise<void> {
    this.generation += 1;
    await this.driver.dispose();
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([
      this.worker.close(),
      this.queueEvents.close(),
      this.queue.close(),
      this.driver.dispose(),
    ]);
  }

  private logBullmqError(
    source: 'queue' | 'queueEvents' | 'worker',
    error: Error,
  ) {
    this.logger.error(
      `QQBot 插件 worker BullMQ ${source} 异常：${error.message}`,
      error.stack,
    );
  }

  private async requestDriverWithTimeout(
    message: QqbotPluginWorkerRequest,
  ): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const requestPromise = this.driver.request(message);
    requestPromise.catch(() => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new QqbotPluginWorkerExpiredRequestError(
            'worker-request-execution-timeout',
          ),
        );
      }, message.timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createQqbotBullmqWorkerQueueOptions(
  configService: ConfigService,
  pluginKey: string,
  installationId: string,
): QqbotBullmqWorkerRequestQueueOptions {
  return {
    connection: resolveQqbotPluginQueueConnection(configService),
    installationId,
    pluginKey,
    prefix: resolveQqbotPluginQueuePrefix(configService),
    queueWaitTimeoutMs: readNumberConfig(
      configService,
      ['QQBOT_PLUGIN_QUEUE_WAIT_TIMEOUT_MS'],
      120_000,
    ),
    removeOnFailCount: readNumberConfig(
      configService,
      ['QQBOT_PLUGIN_QUEUE_REMOVE_ON_FAIL'],
      100,
    ),
    waitUntilFinishedBufferMs: readNumberConfig(
      configService,
      ['QQBOT_PLUGIN_QUEUE_WAIT_BUFFER_MS'],
      5_000,
    ),
    workerInstanceId: createWorkerInstanceId(),
  };
}

export function resolveQqbotPluginQueuePrefix(configService: ConfigService) {
  return readStringConfig(
    configService,
    ['QQBOT_PLUGIN_QUEUE_REDIS_PREFIX'],
    'kt:qqbot:plugin-worker',
  );
}

export function resolveQqbotPluginQueueConnection(
  configService: ConfigService,
): ConnectionOptions {
  const host = readStringConfig(configService, [
    'QQBOT_PLUGIN_QUEUE_REDIS_HOST',
    'REDIS_HOST',
  ]);
  if (!host) {
    throw new Error('QQBot 插件队列缺少 Redis 主机配置');
  }

  const password = readStringConfig(configService, [
    'QQBOT_PLUGIN_QUEUE_REDIS_PASSWORD',
    'REDIS_PASSWORD',
  ]);
  return {
    db: readNumberConfig(
      configService,
      ['QQBOT_PLUGIN_QUEUE_REDIS_DB', 'REDIS_DB'],
      0,
    ),
    host,
    password: password || undefined,
    port: readNumberConfig(
      configService,
      ['QQBOT_PLUGIN_QUEUE_REDIS_PORT', 'REDIS_PORT'],
      6379,
    ),
  };
}

function buildWorkerQueueName(pluginKey: string, installationId: string) {
  const safePluginKey = pluginKey.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeInstallationId = installationId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `qqbot-plugin-worker-${safePluginKey}-${safeInstallationId}`;
}

function createWorkerInstanceId() {
  return [
    process.env.HOSTNAME || 'local',
    process.pid,
    Date.now(),
    Math.random().toString(16).slice(2),
  ].join(':');
}

function readStringConfig(
  configService: ConfigService,
  keys: string[],
  fallback = '',
) {
  for (const key of keys) {
    const value = configService.get<string | number | undefined>(key);
    if (value !== undefined && value !== null && `${value}`.trim()) {
      return `${value}`.trim();
    }
  }
  return fallback;
}

function readNumberConfig(
  configService: ConfigService,
  keys: string[],
  fallback: number,
) {
  const value = readStringConfig(configService, keys);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
