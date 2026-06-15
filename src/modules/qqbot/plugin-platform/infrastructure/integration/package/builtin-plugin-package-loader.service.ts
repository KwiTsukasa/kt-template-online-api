import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { ToolsService } from '@/common';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';
import type {
  QqbotEventPluginDefinition,
  QqbotIntegrationPlugin,
  QqbotNormalizedMessage,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';
import { QqbotPluginHttpClientService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/sdk';
import { createPlugin as createBangDreamPlugin } from '@/modules/qqbot/plugins/bangdream/src';
import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  isFf14LocationName,
  QQBOT_FF14_MARKET_DICT_CODES,
  splitFf14WorldPath,
} from '@/modules/qqbot/plugins/ff14-market/src/domain/ff14-worlds';
import type {
  BangDreamOperationHandlerName,
  BangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream.types';
import type { BangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
import { createPlugin as createFf14MarketPlugin } from '@/modules/qqbot/plugins/ff14-market/src';
import { createPlugin as createFflogsPlugin } from '@/modules/qqbot/plugins/fflogs/src';
import { createPlugin as createRepeaterPlugin } from '@/modules/qqbot/plugins/repeater/src';

export type RepeaterPluginPackage = ReturnType<
  typeof createRepeaterPlugin
>;

export type QqbotEventPluginPackage = {
  bind(selfId: string): Promise<boolean> | boolean;
  getDefinition(): QqbotEventPluginDefinition;
  getSummary(input: {
    accountName?: string;
    connectStatus?: string;
    selfId: string;
  }): Promise<unknown> | unknown;
  handleMessage(message: QqbotNormalizedMessage): Promise<boolean> | boolean;
  unbind(selfId: string): Promise<boolean> | boolean;
};

@Injectable()
export class QqbotBuiltinPluginPackageLoaderService {
  private readonly logger = new Logger(
    QqbotBuiltinPluginPackageLoaderService.name,
  );

  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly configService: ConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
  ) {}

  loadCommandPlugins(): QqbotIntegrationPlugin[] {
    return [
      this.createBangDreamPlugin(),
      this.createFf14MarketPlugin(),
      this.createFflogsPlugin(),
    ];
  }

  loadEventPlugins(): QqbotEventPluginPackage[] {
    return [this.loadRepeaterPlugin()];
  }

  loadRepeaterPlugin(): RepeaterPluginPackage {
    const manifest = this.loadManifest('repeater');
    return createRepeaterPlugin({
      host: {
        bindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .bindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        getBoundEventPluginKeys: (selfId) =>
          this.accountService.getBoundEventPluginKeys(selfId),
        getConfig: (key) => this.configService.get(key),
        sendText: (input) => this.sendService.sendText(input as any),
        unbindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .unbindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        warn: (message) => this.logger.warn(message),
      },
      manifest,
    });
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
        aliases: operation.aliases,
        description: operation.description,
        handlerName: operation.handlerName as BangDreamOperationHandlerName,
        inputSchema: operation.inputSchema,
        key: operation.key as BangDreamOperationKey,
        name: operation.name,
        outputSchema: operation.outputSchema,
        timeoutMs: operation.timeoutMs,
      })),
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
        resolveKnownWorld: (candidate) => this.resolveKnownFf14World(candidate),
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

  private async resolveKnownFf14World(candidate: string) {
    const catalog = await this.loadFf14MarketCatalog();
    if (!isFf14LocationName(catalog, candidate)) return null;
    const worldPath = splitFf14WorldPath(candidate);
    return { serverSlug: worldPath.world || candidate };
  }

  private async loadFf14MarketCatalog() {
    const treeCatalog = buildFf14MarketCatalogFromTree(
      await this.dictService.relationTree({
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.region),
      this.dictService.getDictItemsByKey(
        QQBOT_FF14_MARKET_DICT_CODES.dataCenter,
      ),
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  private resolvePluginRoot(pluginKey: string) {
    const sourceRoot = join(
      process.cwd(),
      `src/modules/qqbot/plugins/${pluginKey}`,
    );
    if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
    return join(__dirname, `../../../../plugins/${pluginKey}`);
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
