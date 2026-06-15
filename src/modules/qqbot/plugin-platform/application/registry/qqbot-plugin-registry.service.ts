import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { formatKtDateTime, throwVbenError, ToolsService } from '@/common';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import type {
  QqbotIntegrationPlugin,
  QqbotPluginHealth,
  QqbotPluginOperationContext,
  QqbotPluginOperationSummary,
  QqbotPluginSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';
import { QqbotPluginHttpClientService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/sdk';
import { createPlugin as createBangDreamPlugin } from '@/modules/qqbot/plugins/bangdream/src';
import type { BangDreamManifestOperation } from '@/modules/qqbot/plugins/bangdream/src';
import type { BangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
import { createPlugin as createFf14MarketPlugin } from '@/modules/qqbot/plugins/ff14-market/src';
import { createPlugin as createFflogsPlugin } from '@/modules/qqbot/plugins/fflogs/src';

@Injectable()
export class QqbotPluginRegistryService implements OnModuleInit {
  private readonly pluginAliases = new Map<string, string>();
  private readonly plugins = new Map<string, QqbotIntegrationPlugin>();

  constructor(
    private readonly configService: ConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
    private readonly toolsService: ToolsService,
  ) {}

  onModuleInit() {
    this.register(this.createBangDreamPlugin());
    this.register(this.createFf14MarketPlugin());
    this.register(this.createFflogsPlugin());
  }

  register(plugin: QqbotIntegrationPlugin) {
    if (!plugin.key || !plugin.operations.length) {
      throwVbenError('QQBot 插件必须包含 key 和 operation');
    }
    this.plugins.set(plugin.key, plugin);
    for (const legacyKey of plugin.legacyKeys || []) {
      if (!legacyKey || legacyKey === plugin.key) continue;
      if (this.plugins.has(legacyKey) || this.pluginAliases.has(legacyKey)) {
        throwVbenError(`QQBot 插件别名重复：${legacyKey}`);
      }
      this.pluginAliases.set(legacyKey, plugin.key);
    }
  }

  listPlugins(): QqbotPluginSummary[] {
    return [...this.plugins.values()].map((plugin) => ({
      description: plugin.description,
      key: plugin.key,
      name: plugin.name,
      operationCount: plugin.operations.length,
      triggerMode: 'command',
      version: plugin.version,
    }));
  }

  listOperations(pluginKey?: string): QqbotPluginOperationSummary[] {
    return this.getPlugins(pluginKey).flatMap((plugin) =>
      plugin.operations.map((operation) => ({
        cacheTtlMs: operation.cacheTtlMs,
        description: operation.description,
        inputSchema: operation.inputSchema,
        key: operation.key,
        name: operation.name,
        outputSchema: operation.outputSchema,
        pluginKey: plugin.key,
        triggerMode: 'command',
      })),
    );
  }

  async health(pluginKey?: string): Promise<QqbotPluginHealth[]> {
    const plugins = this.getPlugins(pluginKey);
    return Promise.all(
      plugins.map(async (plugin) => {
        if (!plugin.healthCheck) {
          return {
            checkedAt: formatKtDateTime(new Date()),
            message: '插件未提供健康检查',
            name: plugin.name,
            pluginKey: plugin.key,
            status: 'healthy',
            triggerMode: 'command' as const,
          };
        }
        return {
          ...(await plugin.healthCheck()),
          name: plugin.name,
          pluginKey: plugin.key,
          triggerMode: 'command' as const,
        };
      }),
    );
  }

  async execute(
    pluginKey: string,
    operationKey: string,
    input: Record<string, any>,
    context: QqbotPluginOperationContext = {},
  ) {
    const operation = this.getOperation(pluginKey, operationKey);
    return operation.execute(input, context);
  }

  assertOperation(pluginKey?: string, operationKey?: string) {
    if (!pluginKey || !operationKey) {
      throwVbenError('请选择插件和插件能力');
    }
    this.getOperation(pluginKey, operationKey);
  }

  private getOperation(pluginKey: string, operationKey: string) {
    const plugin = this.getPluginByKey(pluginKey);
    if (!plugin) throwVbenError(`QQBot 插件不存在：${pluginKey}`);

    const operation = plugin.operations.find(
      (item) => item.key === operationKey,
    );
    if (!operation) {
      throwVbenError(`QQBot 插件能力不存在：${pluginKey}.${operationKey}`);
    }
    return operation;
  }

  private getPlugins(pluginKey?: string) {
    if (!pluginKey) return [...this.plugins.values()];
    const plugin = this.getPluginByKey(pluginKey);
    return plugin ? [plugin] : [];
  }

  private getPluginByKey(pluginKey: string) {
    return (
      this.plugins.get(pluginKey) ||
      this.plugins.get(this.pluginAliases.get(pluginKey) || '')
    );
  }

  private createBangDreamPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('bangdream');
    return createBangDreamPlugin({
      configReader: {
        get: (key) => this.configService.get(key),
      },
      description: manifest.description,
      dictionaryReader: {
        getDictItemsByKey: (dictCode) =>
          this.dictService.getDictItemsByKey(dictCode),
      },
      io: this.createBangDreamRuntimeIo(),
      legacyAliases: manifest.legacyAliases,
      name: manifest.name,
      normalizeError: (error) =>
        this.toolsService.getErrorMessage(error, 'BangDream 命令执行失败'),
      operations: manifest.operations.map((operation) => ({
        description: operation.description,
        handlerName: operation.handlerName,
        inputSchema: operation.inputSchema,
        key: operation.key,
        name: operation.name,
        outputSchema: operation.outputSchema,
      })) as BangDreamManifestOperation[],
      pluginKey: manifest.pluginKey,
      version: manifest.version,
    }) as QqbotIntegrationPlugin;
  }

  private createFf14MarketPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('ff14-market');
    return createFf14MarketPlugin({
      host: {
        getConfig: (key) => this.configService.get(key),
        getDictItemsByKey: (dictCode) =>
          this.dictService.getDictItemsByKey(dictCode),
        relationTree: (input) => this.dictService.relationTree(input),
        requestJson: (options) => this.httpClient.requestJson(options),
      },
      manifest,
      normalizeError: (error, fallback) =>
        this.toolsService.getErrorMessage(error, fallback),
    }) as QqbotIntegrationPlugin;
  }

  private createFflogsPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('fflogs');
    return createFflogsPlugin({
      host: {
        getConfig: (key) => this.configService.get(key),
        getDictByKey: (dictCode) => this.dictService.getDictByKey(dictCode),
        requestJson: (options) => this.httpClient.requestJson(options),
      },
      manifest,
      normalizeError: (error, fallback) =>
        this.toolsService.getErrorMessage(error, fallback),
    }) as QqbotIntegrationPlugin;
  }

  private createBangDreamRuntimeIo(): BangDreamRuntimeIo {
    return {
      getConfig: (key) => this.configService.get(key),
      readAssetFile: async (filePath) => readFileSync(filePath),
      readExcelRows: async (filePath) => readExcelRows(filePath),
      readJsonFile: async (filePath) => readJsonFile(filePath),
      readJsonFileSync: (filePath) => readJsonFile(filePath),
      requestArrayBuffer: async (url, options) => ({
        body: await this.httpClient.requestBuffer({
          context: 'BangDream 资源下载',
          failureMessage: (statusCode) =>
            `BangDream 资源下载失败：${statusCode}`,
          timeoutMessage: 'BangDream 资源下载超时',
          timeoutMs: options?.timeoutMs,
          url,
        }),
      }),
      requestJson: async (url, options) => ({
        body: await this.httpClient.requestJson({
          context: 'BangDream 数据接口',
          failureMessage: (statusCode) =>
            `BangDream 数据接口失败：${statusCode}`,
          invalidJsonMessage: 'BangDream 数据接口返回不是合法 JSON',
          timeoutMessage: 'BangDream 数据接口请求超时',
          timeoutMs: options?.timeoutMs,
          url,
        }),
      }),
      sleep: async (ms) =>
        await new Promise((resolve) => setTimeout(resolve, ms)),
      writeJsonFile: async (filePath, data) =>
        writeFileSync(filePath, JSON.stringify(data)),
    };
  }

  private loadManifest(pluginKey: string): QqbotPluginManifest {
    const pluginRoot = this.resolvePluginRoot(pluginKey);
    return parseQqbotPluginManifest(
      readJsonFile(join(pluginRoot, 'plugin.json')),
      { pluginRoot },
    );
  }

  private resolvePluginRoot(pluginKey: string) {
    const sourceRoot = join(
      process.cwd(),
      `src/modules/qqbot/plugins/${pluginKey}`,
    );
    if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
    return join(__dirname, `../../../plugins/${pluginKey}`);
  }
}

function readJsonFile<T = unknown>(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readExcelRows<T extends Record<string, unknown>>(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(worksheet);
}
