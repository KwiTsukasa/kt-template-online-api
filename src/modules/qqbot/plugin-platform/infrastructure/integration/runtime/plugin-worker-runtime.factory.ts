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
          value === undefined || value === null ? undefined : `${value}`,
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

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.rejectPending(new Error('QQBot 插件 worker 已关闭'));
    if (worker) {
      await worker.terminate();
    }
  }

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
            response.ok === false ? response.message : 'Host call failed',
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

  private rejectPending(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function resolveWorkerEntrypoint() {
  const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
  return join(__dirname, `plugin-worker.thread${extension}`);
}

function resolveWorkerExecArgv() {
  if (!__filename.endsWith('.ts')) return [];
  return ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'];
}
