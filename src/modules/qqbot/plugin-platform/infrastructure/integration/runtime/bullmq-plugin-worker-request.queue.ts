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

  /**
   * 通过 `queue.add` 注册或发布事件。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `type`、`timeoutMs`、`correlationId` 字段。
   * @returns `request` 对应。
   * @throws 当 `this.closed` 成立时拒绝当前输入并抛出 `Error`；当 `result.error.name === 'QqbotPluginWorkerStaleRequestError'` 成立时拒绝当前输入并抛出 `QqbotPluginWorkerStaleRequestError`；
   *   当 `result.error.name === 'QqbotPluginWorkerExpiredRequestError'` 成立时拒绝当前输入并抛出 `QqbotPluginWorkerExpiredRequestError`；
   *   当 `result?.ok === false` 成立时拒绝当前输入并抛出 `QqbotPluginWorkerResponseError`。
   */
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

  /**
   * 通过 `driver.dispose` 清理状态，同时更新 `this.generation` 状态。
   */
  async reset(): Promise<void> {
    this.generation += 1;
    await this.driver.dispose();
  }

  /**
   * 通过 `worker.close` 停止对应能力，通过 `queueEvents.close` 停止对应能力，通过 `queue.close` 停止对应能力。
   */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([
      this.worker.close(),
      this.queueEvents.close(),
      this.queue.close(),
      this.driver.dispose(),
    ]);
  }

  /**
   * 通过 `logger.error` 记录带上下文的运行异常或诊断信息。
   * @param source - 决定日志Bullmq错误内容、边界或目标的 `source` 值。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private logBullmqError(
    source: 'queue' | 'queueEvents' | 'worker',
    error: Error,
  ) {
    this.logger.error(
      `QQBot 插件 worker BullMQ ${source} 异常：${error.message}`,
      error.stack,
    );
  }

  /**
   * 按`message`投递Driver超时；从受控资源来源加载所需数据（`driver.request`）。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `timeoutMs` 字段。
   * @returns Driver超时。
   */
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

/**
 * 根据`configService`、`pluginKey`、`installationId`构造QqbotBullmq工作进程Queue选项；从 `readNumberConfig` 读取QqbotBullmq工作进程Queue选项。
 * @param configService - 读取QqbotBullmq工作进程Queue选项所需运行配置的配置服务。
 * @param pluginKey - 用于读取或更新QqbotBullmq工作进程Queue选项的稳定键。
 * @param installationId - 用于精确定位安装记录的标识。
 * @returns 包含 `connection`、`installationId`、`pluginKey`、`prefix`、`queueWaitTimeoutMs` 字段的QqbotBullmq工作进程Queue选项。
 */
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

/**
 * 从`configService`解析Qqbot插件QueuePrefix；从 `readStringConfig` 读取Qqbot插件QueuePrefix。
 * @param configService - 读取Qqbot插件QueuePrefix所需运行配置的配置服务。
 * @returns Qqbot插件QueuePrefix。
 */
export function resolveQqbotPluginQueuePrefix(configService: ConfigService) {
  return readStringConfig(
    configService,
    ['QQBOT_PLUGIN_QUEUE_REDIS_PREFIX'],
    'kt:qqbot:plugin-worker',
  );
}

/**
 * 从`configService`解析Qqbot插件Queue连接；从 `readStringConfig` 读取Qqbot插件Queue连接。
 * @param configService - 读取Qqbot插件Queue连接所需运行配置的配置服务。
 * @returns 包含 `db`、`host`、`password`、`port` 字段的Qqbot插件Queue连接。
 * @throws 当 `!host` 成立时拒绝当前输入并抛出 `Error`。
 */
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

/**
 * 根据`pluginKey`、`installationId`构造工作进程Queue名称。
 * @param pluginKey - 用于读取或更新工作进程Queue名称的稳定键。
 * @param installationId - 用于精确定位安装记录的标识。
 * @returns 按参数编码并拼接完成的工作进程Queue名称。
 */
function buildWorkerQueueName(pluginKey: string, installationId: string) {
  const safePluginKey = pluginKey.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeInstallationId = installationId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `qqbot-plugin-worker-${safePluginKey}-${safeInstallationId}`;
}

/**
 * 将主机名、进程号、当前毫秒和随机后缀组合为本次工作进程的实例标识。
 * @returns 可区分并发工作进程启动实例的标识；主机名缺失时使用 `local`。
 */
function createWorkerInstanceId() {
  return [
    process.env.HOSTNAME || 'local',
    process.pid,
    Date.now(),
    Math.random().toString(16).slice(2),
  ].join(':');
}

/**
 * 按`configService`、`keys`、`fallback`读取字符串配置；当 `value !== undefined && value !== null && `${value}`.trim()` 成立时返回 ``${value}`.trim()`。
 * @param configService - 读取字符串配置所需运行配置的配置服务。
 * @param keys - 决定字符串配置内容、边界或目标的 `keys` 值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
 * @returns 字符串配置。
 */
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

/**
 * 按`configService`、`keys`、`fallback`读取数值配置；当 `Number.isFinite(parsed)` 成立时返回 `parsed`。
 * @param configService - 读取数值配置所需运行配置的配置服务。
 * @param keys - 决定数值配置内容、边界或目标的 `keys` 值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 数值配置。
 */
function readNumberConfig(
  configService: ConfigService,
  keys: string[],
  fallback: number,
) {
  const value = readStringConfig(configService, keys);
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}
