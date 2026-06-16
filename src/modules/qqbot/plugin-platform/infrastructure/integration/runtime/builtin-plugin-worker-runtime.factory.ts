import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { throwVbenError } from '@/common';
import {
  QqbotBuiltinPluginPackageLoaderService,
} from '../package/builtin-plugin-package-loader.service';
import type {
  QqbotPluginRuntimeFactory,
} from '@/modules/qqbot/plugin-platform/application/plugin-platform.service';
import type {
  QqbotPluginInstallation,
  QqbotPluginVersion,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';
import {
  QqbotPluginWorkerResponseError,
  QqbotPluginWorkerRuntime,
  serializePluginWorkerResponseError,
} from './worker-runtime';
import {
  createQqbotBullmqWorkerQueueOptions,
  QqbotBullmqPluginWorkerRequestQueue,
} from './bullmq-plugin-worker-request.queue';
import type {
  QqbotPluginWorkerDriver,
  QqbotPluginWorkerRequest,
} from './worker-runtime.types';

@Injectable()
export class QqbotBuiltinPluginWorkerRuntimeFactoryService
  implements QqbotPluginRuntimeFactory
{
  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
    private readonly configService: ConfigService,
  ) {}

  create(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ) {
    const pluginKey = getManifestPluginKey(version.manifestJson);
    const driver = new QqbotBuiltinPluginWorkerThreadDriver(
      this.pluginLoader,
      pluginKey,
    );
    return new QqbotPluginWorkerRuntime(
      new QqbotBullmqPluginWorkerRequestQueue(
        driver,
        createQqbotBullmqWorkerQueueOptions(
          this.configService,
          pluginKey,
          installation.id,
        ),
      ),
      {
        defaultTimeoutMs: getDefaultRuntimeTimeout(version.manifestJson),
        installationId: installation.id,
        pluginKey,
      },
    );
  }
}

type WorkerBridgeMessage =
  | {
      ok: boolean;
      requestId: string;
      result?: unknown;
      error?: { message?: string; name?: string; stack?: string };
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

export class QqbotBuiltinPluginWorkerThreadDriver
  implements QqbotPluginWorkerDriver
{
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private worker?: Worker;

  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
    private readonly pluginKey: string,
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
        pluginKey: this.pluginKey,
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
        this.rejectPending(
          new Error(`QQBot 插件 worker 异常退出：${code}`),
        );
      }
    });
    this.worker = worker;
    return worker;
  }

  private async handleWorkerMessage(message: WorkerBridgeMessage) {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) return;
      this.pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.result);
        return;
      }
      pending.reject(new QqbotPluginWorkerResponseError(message.error || {}));
      return;
    }

    try {
      const result = await this.pluginLoader.handleWorkerHostCall(
        message.method,
        message.args,
      );
      this.worker?.postMessage({
        ok: true,
        requestId: message.requestId,
        result,
        type: 'hostResponse',
      });
    } catch (error) {
      this.worker?.postMessage({
        error: serializeWorkerError(error),
        ok: false,
        requestId: message.requestId,
        type: 'hostResponse',
      });
    }
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
  return join(__dirname, `builtin-plugin-worker.thread${extension}`);
}

function resolveWorkerExecArgv() {
  if (!__filename.endsWith('.ts')) return [];
  return ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'];
}

function serializeWorkerError(error: unknown) {
  return serializePluginWorkerResponseError(error);
}

function getManifestPluginKey(manifest: unknown) {
  const pluginKey =
    typeof manifest === 'object' && manifest
      ? (manifest as { pluginKey?: unknown }).pluginKey
      : null;
  if (typeof pluginKey === 'string' && pluginKey) return pluginKey;
  throwVbenError('插件 manifest 缺少 pluginKey，无法创建运行时');
}

function getDefaultRuntimeTimeout(manifest: unknown) {
  const runtime =
    typeof manifest === 'object' && manifest
      ? (manifest as { runtime?: { timeoutMs?: unknown } }).runtime
      : null;
  const timeoutMs = Number(runtime?.timeoutMs || 30_000);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
}
