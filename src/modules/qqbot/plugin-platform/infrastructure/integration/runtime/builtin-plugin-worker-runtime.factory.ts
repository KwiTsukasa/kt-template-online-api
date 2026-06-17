import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { throwVbenError } from '@/common';
import { QqbotBuiltinPluginPackageLoaderService } from '../package/builtin-plugin-package-loader.service';
import type { QqbotPluginRuntimeFactory } from '@/modules/qqbot/plugin-platform/application/plugin-platform.service';
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
export class QqbotBuiltinPluginWorkerRuntimeFactoryService implements QqbotPluginRuntimeFactory {
  /**
   * 初始化 QqbotBuiltinPluginWorkerRuntimeFactoryService 实例。
   * @param pluginLoader - pluginLoader 输入；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 创建数据。
   * @param installation - installation 输入；使用 `id` 字段生成结果。
   * @param version - version 输入；使用 `manifestJson` 字段生成结果。
   */
  create(installation: QqbotPluginInstallation, version: QqbotPluginVersion) {
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

export class QqbotBuiltinPluginWorkerThreadDriver implements QqbotPluginWorkerDriver {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private worker?: Worker;

  /**
   * 初始化 QqbotBuiltinPluginWorkerThreadDriver 实例。
   * @param pluginLoader - pluginLoader 输入；影响 constructor 的返回值。
   * @param pluginKey - pluginKey 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
    private readonly pluginKey: string,
  ) {}

  /**
   * 执行 QQBot 插件平台流程。
   * @param message - message 输入；使用 `correlationId` 字段生成结果。
   * @returns 异步完成后的 QQBot 插件平台结果。
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
   * 执行 QQBot 插件平台流程。
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
   * 确保Worker。
   */
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
        this.rejectPending(new Error(`QQBot 插件 worker 异常退出：${code}`));
      }
    });
    this.worker = worker;
    return worker;
  }

  /**
   * 处理Worker Message。
   * @param message - message 输入；使用 `type`、`requestId`、`ok`、`result` 字段生成结果。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  private rejectPending(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

/**
 * 解析Worker Entrypoint。
 */
function resolveWorkerEntrypoint() {
  const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
  return join(__dirname, `builtin-plugin-worker.thread${extension}`);
}

/**
 * 解析Worker Exec Argv。
 */
function resolveWorkerExecArgv() {
  if (!__filename.endsWith('.ts')) return [];
  return ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'];
}

/**
 * 序列化Worker Error。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 */
function serializeWorkerError(error: unknown) {
  return serializePluginWorkerResponseError(error);
}

/**
 * 查询 QQBot 插件平台数据。
 * @param manifest - manifest 输入；驱动 `throwVbenError()` 的 插件平台步骤。
 */
function getManifestPluginKey(manifest: unknown) {
  const pluginKey =
    typeof manifest === 'object' && manifest
      ? (manifest as { pluginKey?: unknown }).pluginKey
      : null;
  if (typeof pluginKey === 'string' && pluginKey) return pluginKey;
  throwVbenError('插件 manifest 缺少 pluginKey，无法创建运行时');
}

/**
 * 查询 QQBot 插件平台数据。
 * @param manifest - manifest 输入；限定 插件平台查询范围。
 */
function getDefaultRuntimeTimeout(manifest: unknown) {
  const runtime =
    typeof manifest === 'object' && manifest
      ? (manifest as { runtime?: { timeoutMs?: unknown } }).runtime
      : null;
  const timeoutMs = Number(runtime?.timeoutMs || 30_000);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
}
