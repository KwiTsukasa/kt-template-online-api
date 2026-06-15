import { Injectable } from '@nestjs/common';
import { throwVbenError } from '@/common';
import {
  QqbotBuiltinPluginPackageLoaderService,
  type QqbotEventPluginPackage,
} from '../package/builtin-plugin-package-loader.service';
import type {
  QqbotIntegrationPlugin,
  QqbotPluginOperation,
  QqbotNormalizedMessage,
} from '@/modules/qqbot/core/contract/qqbot.types';
import type {
  QqbotPluginRuntimeFactory,
} from '@/modules/qqbot/plugin-platform/application/plugin-platform.service';
import type {
  QqbotPluginInstallation,
  QqbotPluginVersion,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';
import {
  QqbotPluginWorkerRuntime,
} from './worker-runtime';
import type {
  QqbotPluginWorkerDriver,
  QqbotPluginWorkerRequest,
} from './worker-runtime.types';

type RuntimeCommandPlugin = QqbotIntegrationPlugin & {
  activate?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
};

@Injectable()
export class QqbotBuiltinPluginWorkerRuntimeFactoryService
  implements QqbotPluginRuntimeFactory
{
  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
  ) {}

  create(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ) {
    const pluginKey = getManifestPluginKey(version.manifestJson);
    return new QqbotPluginWorkerRuntime(
      new QqbotBuiltinPluginWorkerDriver(this.pluginLoader, pluginKey),
      {
        defaultTimeoutMs: getDefaultRuntimeTimeout(version.manifestJson),
        installationId: installation.id,
        pluginKey,
      },
    );
  }
}

class QqbotBuiltinPluginWorkerDriver implements QqbotPluginWorkerDriver {
  private commandPlugin?: RuntimeCommandPlugin;
  private eventPlugin?: QqbotEventPluginPackage;

  constructor(
    private readonly pluginLoader: QqbotBuiltinPluginPackageLoaderService,
    private readonly pluginKey: string,
  ) {}

  async request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    switch (message.type) {
      case 'load':
        return this.load();
      case 'activate':
        await this.commandPlugin?.activate?.();
        return { ok: true };
      case 'health':
        return this.health();
      case 'executeOperation':
        return this.executeOperation(message);
      case 'handleEvent':
        return this.handleEvent(message);
      case 'deactivate':
        return { ok: true };
      case 'dispose':
        await this.commandPlugin?.dispose?.();
        return { ok: true };
      default:
        throwVbenError(`未知插件运行时请求：${message.type}`);
    }
  }

  async dispose(): Promise<void> {
    await this.commandPlugin?.dispose?.();
  }

  private load() {
    this.commandPlugin = this.pluginLoader
      .loadCommandPlugins()
      .find((plugin) => plugin.key === this.pluginKey) as
      | RuntimeCommandPlugin
      | undefined;
    this.eventPlugin = this.pluginLoader
      .loadEventPlugins()
      .find((plugin) => plugin.getDefinition().key === this.pluginKey);

    if (!this.commandPlugin && !this.eventPlugin) {
      throwVbenError(`QQBot 插件运行时不存在：${this.pluginKey}`);
    }

    return {
      ok: true,
      pluginKey: this.pluginKey,
      triggerMode: this.commandPlugin ? 'command' : 'event',
    };
  }

  private async health() {
    if (this.commandPlugin?.healthCheck) {
      return this.commandPlugin.healthCheck();
    }
    if (this.eventPlugin) {
      return {
        message: this.eventPlugin.getDefinition().remark || '事件插件可用',
        status: 'healthy',
      };
    }
    throwVbenError(`QQBot 插件运行时未加载：${this.pluginKey}`);
  }

  private async executeOperation(message: QqbotPluginWorkerRequest) {
    const operation = this.commandPlugin?.operations.find(
      (item: QqbotPluginOperation) => item.key === message.operationKey,
    );
    if (!operation) {
      throwVbenError(`QQBot 插件能力不存在：${message.operationKey}`);
    }
    return operation.execute(
      (message.input || {}) as Record<string, unknown>,
      {},
    );
  }

  private async handleEvent(message: QqbotPluginWorkerRequest) {
    if (!this.eventPlugin) {
      return false;
    }
    const definition = this.eventPlugin.getDefinition();
    if (message.eventKey && message.eventKey !== definition.key) return false;
    if (definition.triggerType !== 'message') return false;
    return this.eventPlugin.handleMessage(
      (message.event || {}) as QqbotNormalizedMessage,
    );
  }
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
