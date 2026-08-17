import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { QqbotPluginPackageSourceService } from '../package/plugin-package-source.service';
import type {
  QqbotPluginPackageDescriptor,
  QqbotPluginRuntimeConfigSnapshot,
} from '../package/plugin-package.types';
import { QqbotPluginHostBridgeService } from './plugin-host-bridge.service';
import {
  createQqbotBullmqWorkerQueueOptions,
  QqbotBullmqPluginWorkerRequestQueue,
} from './bullmq-plugin-worker-request.queue';
import {
  QqbotPluginWorkerResponseError,
  QqbotPluginWorkerRuntime,
  serializePluginWorkerResponseError,
} from './worker-runtime';
import type {
  QqbotPluginWorkerDriver,
  QqbotPluginWorkerRequest,
} from './worker-runtime.types';
import type { QqbotPluginRuntimeFactory } from '@/modules/qqbot/plugin-platform/application/plugin-platform.service';
import type {
  QqbotPluginInstallation,
  QqbotPluginVersion,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';

type WorkerBridgeMessage =
  | {
      error?: { message?: string; name?: string; stack?: string };
      ok: boolean;
      requestId: string;
      result?: unknown;
      type: 'response';
    }
  | {
      args?: Record<string, unknown>;
      method: string;
      requestId: string;
      type: 'hostCall';
    };

type PendingRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type QqbotPluginWorkerThreadDriverOptions = {
  configSnapshot: QqbotPluginRuntimeConfigSnapshot;
  descriptor: QqbotPluginPackageDescriptor;
  installationId: string;
  pluginKey: string;
};

@Injectable()
export class QqbotPluginWorkerRuntimeFactoryService implements QqbotPluginRuntimeFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly packageSource: QqbotPluginPackageSourceService,
    private readonly hostBridge: QqbotPluginHostBridgeService,
  ) {}

  /**
   * 根据`installation`、`version`构造QQBot插件运行态记录。
   * @param installation - 用于QQBot插件运行态记录的领域对象，包含 `installedPath`、`id` 字段。
   * @param version - 用于QQBot插件运行态记录的领域对象，包含 `manifestJson` 字段。
   * @returns 完成初始化并携带当前边界配置的QQBot插件运行态记录。
   */
  create(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ): QqbotPluginWorkerRuntime {
    const descriptor = this.packageSource.resolveDescriptor(
      installation.installedPath,
      version.manifestJson,
    );
    const configSnapshot = this.createConfigSnapshot(descriptor);
    const driver = new QqbotPluginWorkerThreadDriver(this.hostBridge, {
      configSnapshot,
      descriptor,
      installationId: installation.id,
      pluginKey: descriptor.pluginKey,
    });

    return new QqbotPluginWorkerRuntime(
      new QqbotBullmqPluginWorkerRequestQueue(
        driver,
        createQqbotBullmqWorkerQueueOptions(
          this.configService,
          descriptor.pluginKey,
          installation.id,
        ),
      ),
      {
        configSnapshot,
        defaultTimeoutMs: descriptor.manifest.runtime.timeoutMs,
        descriptor,
        installationId: installation.id,
        pluginKey: descriptor.pluginKey,
      },
    );
  }

  /**
   * 根据`descriptor`构造配置快照。
   * @param descriptor - 用于配置快照的领域对象，包含 `manifest` 字段。
   * @returns 配置快照。
   */
  private createConfigSnapshot(
    descriptor: QqbotPluginPackageDescriptor,
  ): QqbotPluginRuntimeConfigSnapshot {
    return Object.fromEntries(
      descriptor.manifest.runtime.configKeys.map((key) => {
        const value = this.configService.get<string | number | boolean | null>(
          key,
        );
        return [
          key,
          (() => {
            if (value === undefined || value === null) {
              return undefined;
            }
            return `${value}`;
          })(),
        ];
      }),
    );
  }
}

export class QqbotPluginWorkerThreadDriver implements QqbotPluginWorkerDriver {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private worker?: Worker;

  constructor(
    private readonly hostBridge: QqbotPluginHostBridgeService,
    private readonly options: QqbotPluginWorkerThreadDriverOptions,
  ) {}

  /**
   * 按`message`投递QQBot插件线程驱动记录。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `correlationId` 字段。
   * @returns 完成初始化并携带当前边界配置的QQBot插件线程驱动记录。
   */
  async request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(message.correlationId, { reject, resolve });
      worker.postMessage({
        message,
        requestId: message.correlationId,
        type: 'request',
      });
    });
  }

  /**
   * 按当前运行态移除QQBot插件线程驱动记录。
   */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.rejectPending(new Error('QQBot 插件 worker 已关闭'));
    if (worker) {
      await worker.terminate();
    }
  }

  /**
   * 确保工作进程存在且保持一致；缺失时根据当前运行态补齐对应状态。
   * @returns 工作进程。
   */
  private ensureWorker() {
    if (this.worker) return this.worker;

    const worker = new Worker(resolveWorkerEntrypoint(), {
      execArgv: resolveWorkerExecArgv(),
      workerData: {
        configSnapshot: this.options.configSnapshot,
        descriptor: this.options.descriptor,
        installationId: this.options.installationId,
        pluginKey: this.options.pluginKey,
      },
    });
    worker.on('message', (message: WorkerBridgeMessage) => {
      void this.handleWorkerMessage(message);
    });
    worker.on('error', (error) => {
      this.worker = undefined;
      this.rejectPending(error);
    });
    worker.on('exit', (code) => {
      this.worker = undefined;
      if (code !== 0) {
        this.rejectPending(new Error(`QQBot 插件 worker 异常退出：${code}`));
      }
    });
    this.worker = worker;
    return worker;
  }

  /**
   * 根据`message`处理工作进程消息；当 `message.type === 'response'` 成立时直接结束且不产生返回值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `type`、`args`、`method`、`requestId` 字段。
   */
  private async handleWorkerMessage(message: WorkerBridgeMessage) {
    if (message.type === 'response') {
      this.settleWorkerResponse(message);
      return;
    }

    try {
      const response = await this.hostBridge.handleHostCall(
        this.options.descriptor,
        {
          args: message.args || {},
          method: message.method,
          pluginKey: this.options.pluginKey,
        },
      );
      if (response.ok === true) {
        this.worker?.postMessage({
          ok: true,
          requestId: message.requestId,
          result: response.value,
          type: 'hostResponse',
        });
        return;
      }
      this.worker?.postMessage({
        error: {
          message:
            (() => {
              if (response.ok === false) {
                return response.message;
              }
              return 'Host call failed';
            })(),
          name: 'QqbotPluginHostCallError',
        },
        ok: false,
        requestId: message.requestId,
        type: 'hostResponse',
      });
    } catch (error) {
      this.worker?.postMessage({
        error: serializePluginWorkerResponseError(error),
        ok: false,
        requestId: message.requestId,
        type: 'hostResponse',
      });
    }
  }

  /**
   * 按请求标识移除待处理工作进程调用，并依据响应状态兑现或拒绝对应 Promise。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `requestId`、`ok`、`result`、`error` 字段。
   */
  private settleWorkerResponse(
    message: Extract<WorkerBridgeMessage, { type: 'response' }>,
  ) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    this.pendingRequests.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new QqbotPluginWorkerResponseError(message.error || {}));
  }

  /**
   * 以统一异常拒绝待处理。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private rejectPending(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

/**
 * 从当前运行态解析工作进程入口。
 * @returns 工作进程入口。
 */
function resolveWorkerEntrypoint() {
  const extension = (() => {
    if (__filename.endsWith('.ts')) {
      return '.ts';
    }
    return '.js';
  })();
  return join(__dirname, `plugin-worker.thread${extension}`);
}

/**
 * 解析工作进程执行参数；通过 `__filename.endsWith` 校验工作进程执行参数相关条件。
 * @returns 返回按当前输入生成的工作进程执行参数列表；没有元素时为空数组。
 */
function resolveWorkerExecArgv() {
  if (!__filename.endsWith('.ts')) return [];
  return ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'];
}
