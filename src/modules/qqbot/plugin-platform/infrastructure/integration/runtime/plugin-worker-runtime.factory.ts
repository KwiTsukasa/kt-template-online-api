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
  /**
   * Creates the descriptor-based worker runtime factory.
   * @param configService - Nest config source used for BullMQ queue options and runtime config snapshots.
   * @param packageSource - Package descriptor resolver that applies controlled-root and entry policies.
   * @param hostBridge - Generic host bridge used by worker host-call RPC messages.
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly packageSource: QqbotPluginPackageSourceService,
    private readonly hostBridge: QqbotPluginHostBridgeService,
  ) {}

  /**
   * Creates a worker runtime for one plugin installation and version descriptor.
   * @param installation - Installation row whose `installedPath` identifies the package root.
   * @param version - Version row whose `manifestJson` is the source of runtime manifest semantics.
   * @returns Worker runtime backed by a descriptor-based worker thread and BullMQ serialization queue.
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
   * Captures manifest-declared runtime config keys without hard-coding plugin-specific names.
   * @param descriptor - Package descriptor whose manifest owns the config key declarations.
   * @returns String snapshot preserving missing keys as `undefined`.
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
          value === undefined || value === null ? undefined : `${value}`,
        ];
      }),
    );
  }
}

export class QqbotPluginWorkerThreadDriver implements QqbotPluginWorkerDriver {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private worker?: Worker;

  /**
   * Creates a thread driver for one descriptor-based plugin runtime.
   * @param hostBridge - Generic platform host bridge used to satisfy worker host calls.
   * @param options - Descriptor, installation id, plugin key, and config snapshot passed to workerData.
   */
  constructor(
    private readonly hostBridge: QqbotPluginHostBridgeService,
    private readonly options: QqbotPluginWorkerThreadDriverOptions,
  ) {}

  /**
   * Sends one runtime request to the worker thread and waits for its response.
   * @param message - Lifecycle, operation, task, or event request produced by QqbotPluginWorkerRuntime.
   * @returns Worker response payload for the requested plugin action.
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
   * Terminates the worker thread and rejects in-flight requests for this runtime instance.
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
   * Lazily starts the worker thread with descriptor, installation, plugin key, and config snapshot workerData.
   * @returns Active worker thread for the current descriptor runtime.
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
   * Handles worker responses and host-call requests emitted by the child thread.
   * @param message - Worker bridge message containing either a runtime response or a host capability request.
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

  /**
   * Resolves or rejects one pending runtime request from a worker response message.
   * @param message - Worker response carrying the original request id and serialized result or error.
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
   * Rejects all in-flight requests when the worker exits or is disposed.
   * @param error - Runtime boundary error propagated to all pending callers.
   */
  private rejectPending(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

/**
 * Resolves the generic worker thread entrypoint next to the compiled factory file.
 * @returns Absolute worker entry file path with the current TypeScript or JavaScript extension.
 */
function resolveWorkerEntrypoint() {
  const extension = __filename.endsWith('.ts') ? '.ts' : '.js';
  return join(__dirname, `plugin-worker.thread${extension}`);
}

/**
 * Resolves worker exec arguments needed when tests or local dev run TypeScript sources directly.
 * @returns Node exec arguments that register ts-node only for `.ts` runtime files.
 */
function resolveWorkerExecArgv() {
  if (!__filename.endsWith('.ts')) return [];
  return ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'];
}
