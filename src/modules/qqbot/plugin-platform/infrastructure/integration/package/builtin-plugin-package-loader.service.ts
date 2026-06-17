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

const BUILTIN_PLUGIN_KEYS = [
  'bangdream',
  'ff14-market',
  'fflogs',
  'repeater',
] as const;

export type RepeaterPluginPackage = ReturnType<typeof createRepeaterPlugin>;

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

  /**
   * 初始化 QqbotBuiltinPluginPackageLoaderService 实例。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   * @param dictService - dictService 服务依赖；影响 constructor 的返回值。
   * @param httpClient - httpClient 客户端依赖；影响 constructor 的返回值。
   * @param sendService - sendService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly configService: ConfigService,
    private readonly dictService: DictService,
    private readonly httpClient: QqbotPluginHttpClientService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 加载Command Plugins。
   * @returns QQBot 插件平台产出的 QqbotIntegrationPlugin[]。
   */
  loadCommandPlugins(): QqbotIntegrationPlugin[] {
    return [
      this.createBangDreamPlugin(),
      this.createFf14MarketPlugin(),
      this.createFflogsPlugin(),
    ];
  }

  /**
   * 加载Event Plugins。
   * @returns QQBot 插件平台产出的 QqbotEventPluginPackage[]。
   */
  loadEventPlugins(): QqbotEventPluginPackage[] {
    return [this.loadRepeaterPlugin()];
  }

  /**
   * 加载Builtin Manifests。
   * @returns QQBot 插件平台产出的 QqbotPluginManifest[]。
   */
  loadBuiltinManifests(): QqbotPluginManifest[] {
    return BUILTIN_PLUGIN_KEYS.map((pluginKey) => this.loadManifest(pluginKey));
  }

  /**
   * 处理Worker Host Call。
   * @param method - HTTP 方法名；影响 handleWorkerHostCall 的返回值。
   * @param args - 插件平台列表；使用 `selfId`、`pluginKey`、`key`、`dictCode` 字段生成结果。
   */
  async handleWorkerHostCall(method: string, args: Record<string, any> = {}) {
    switch (method) {
      case 'bindEventPlugin':
        await this.accountService.bindEventPlugin(args.selfId, args.pluginKey);
        return undefined;
      case 'getBoundEventPluginKeys':
        return this.accountService.getBoundEventPluginKeys(args.selfId);
      case 'getConfig':
        return this.configService.get(args.key);
      case 'getDictByKey':
        return this.dictService.getDictByKey(args.dictCode);
      case 'getDictItemsByKey':
        return this.dictService.getDictItemsByKey(args.dictCode);
      case 'relationTree':
        return this.dictService.relationTree(args.input);
      case 'bangdreamRequestBuffer':
        return this.httpClient.requestBuffer(
          createWorkerHttpRequest(
            args.options,
            (statusCode) => `BangDream 资源下载失败：${statusCode}`,
          ),
        );
      case 'bangdreamRequestJson':
        return this.httpClient.requestJson(
          createWorkerHttpRequest(
            args.options,
            (statusCode) => `BangDream 数据接口失败：${statusCode}`,
          ),
        );
      case 'requestBuffer':
        return this.httpClient.requestBuffer(
          createWorkerHttpRequest(args.options),
        );
      case 'requestJson':
        return this.httpClient.requestJson(
          createWorkerHttpRequest(args.options),
        );
      case 'sendText':
        return this.sendService.sendText(args.input);
      case 'unbindEventPlugin':
        await this.accountService.unbindEventPlugin(
          args.selfId,
          args.pluginKey,
        );
        return undefined;
      case 'warn':
        this.logger.warn(args.message);
        return undefined;
      default:
        throw new Error(`未知插件 Host 调用：${method}`);
    }
  }

  /**
   * 加载Repeater Plugin。
   * @returns QQBot 插件平台产出的 RepeaterPluginPackage。
   */
  loadRepeaterPlugin(): RepeaterPluginPackage {
    const manifest = this.loadManifest('repeater');
    return createRepeaterPlugin({
      host: {
        /**
         * 维护 插件平台事件绑定。
         * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
         * @param pluginKey - pluginKey 输入；驱动 `bindEventPlugin()` 的 插件平台步骤。
         */
        bindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .bindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        /**
         * 读取 插件平台回调数据。
         * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
         */
        getBoundEventPluginKeys: (selfId) =>
          this.accountService.getBoundEventPluginKeys(selfId),
        /**
         * 读取 插件平台回调数据。
         * @param key - 键名；驱动 `configService.get()` 的 插件平台步骤。
         */
        getConfig: (key) => this.configService.get(key),
        /**
         * 发送 插件平台回调消息。
         * @param input - input 输入；驱动 `sendService.sendText()` 的 插件平台步骤。
         */
        sendText: (input) => this.sendService.sendText(input as any),
        /**
         * 维护 插件平台事件绑定。
         * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
         * @param pluginKey - pluginKey 输入；驱动 `unbindEventPlugin()` 的 插件平台步骤。
         */
        unbindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .unbindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        /**
         * 记录 插件平台回调日志。
         * @param message - message 输入；驱动 `logger.warn()` 的 插件平台步骤。
         */
        warn: (message) => this.logger.warn(message),
      },
      manifest,
    });
  }

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @returns 创建后的 QQBot 插件平台对象或配置。
   */
  private createBangDreamPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('bangdream');
    return createBangDreamPlugin({
      configReader: {
        /**
         * 读取 插件平台回调数据。
         * @param key - 键名；驱动 `configService.get()` 的 插件平台步骤。
         */
        get: (key) => this.configService.get(key),
      },
      description: manifest.description,
      dictionaryReader: {
        /**
         * 读取 插件平台回调数据。
         * @param dictCode - dictCode 输入；驱动 `dictService.getDictItemsByKey()` 的 插件平台步骤。
         */
        getDictItemsByKey: (dictCode) =>
          this.dictService.getDictItemsByKey(dictCode),
      },
      io: this.createBangDreamRuntimeIo(),
      legacyAliases: manifest.legacyAliases,
      name: manifest.name,
      /**
       * 执行 插件平台回调。
       * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
       */
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

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @returns 创建后的 QQBot 插件平台对象或配置。
   */
  private createFf14MarketPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('ff14-market');
    return createFf14MarketPlugin({
      host: {
        /**
         * 读取 插件平台回调数据。
         * @param key - 键名；驱动 `configService.get()` 的 插件平台步骤。
         */
        getConfig: (key) => this.configService.get(key),
        /**
         * 读取 插件平台回调数据。
         * @param dictCode - dictCode 输入；驱动 `dictService.getDictItemsByKey()` 的 插件平台步骤。
         */
        getDictItemsByKey: (dictCode) =>
          this.dictService.getDictItemsByKey(dictCode),
        /**
         * 执行 插件平台回调。
         * @param input - input 输入；驱动 `dictService.relationTree()` 的 插件平台步骤。
         */
        relationTree: (input) => this.dictService.relationTree(input),
        /**
         * 执行 插件平台回调。
         * @param options - 插件平台列表；驱动 `httpClient.requestJson()` 的 插件平台步骤。
         */
        requestJson: (options) => this.httpClient.requestJson(options),
      },
      manifest,
      /**
       * 执行 插件平台回调。
       * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
       * @param fallback - 兜底值；驱动 `toolsService.getErrorMessage()` 的 插件平台步骤。
       */
      normalizeError: (error, fallback) =>
        this.toolsService.getErrorMessage(error, fallback),
    }) as QqbotIntegrationPlugin;
  }

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @returns 创建后的 QQBot 插件平台对象或配置。
   */
  private createFflogsPlugin(): QqbotIntegrationPlugin {
    const manifest = this.loadManifest('fflogs');
    return createFflogsPlugin({
      host: {
        /**
         * 读取 插件平台回调数据。
         * @param key - 键名；驱动 `configService.get()` 的 插件平台步骤。
         */
        getConfig: (key) => this.configService.get(key),
        /**
         * 读取 插件平台回调数据。
         * @param dictCode - dictCode 输入；驱动 `dictService.getDictByKey()` 的 插件平台步骤。
         */
        getDictByKey: (dictCode) => this.dictService.getDictByKey(dictCode),
        /**
         * 执行 插件平台回调。
         * @param candidate - candidate 输入；驱动 `this.resolveKnownFf14World()` 的 插件平台步骤。
         */
        resolveKnownWorld: (candidate) => this.resolveKnownFf14World(candidate),
        /**
         * 执行 插件平台回调。
         * @param options - 插件平台列表；驱动 `httpClient.requestJson()` 的 插件平台步骤。
         */
        requestJson: (options) => this.httpClient.requestJson(options),
      },
      manifest,
      /**
       * 执行 插件平台回调。
       * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
       * @param fallback - 兜底值；驱动 `toolsService.getErrorMessage()` 的 插件平台步骤。
       */
      normalizeError: (error, fallback) =>
        this.toolsService.getErrorMessage(error, fallback),
    }) as QqbotIntegrationPlugin;
  }

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @returns 创建后的 QQBot 插件平台对象或配置。
   */
  private createBangDreamRuntimeIo(): BangDreamRuntimeIo {
    return {
      /**
       * 读取 插件平台回调数据。
       * @param key - 键名；驱动 `configService.get()` 的 插件平台步骤。
       */
      getConfig: (key) => this.configService.get(key),
      /**
       * 执行 插件平台回调。
       * @param filePath - 插件平台路径；读取本地文件内容。
       */
      readAssetFile: async (filePath) => readFileSync(filePath),
      /**
       * 执行 插件平台回调。
       * @param filePath - 插件平台路径；驱动 `readExcelRows()` 的 插件平台步骤。
       */
      readExcelRows: async (filePath) => readExcelRows(filePath),
      /**
       * 执行 插件平台回调。
       * @param filePath - 插件平台路径；驱动 `readJsonFile()` 的 插件平台步骤。
       */
      readJsonFile: async (filePath) => readJsonFile(filePath),
      /**
       * 执行 插件平台回调。
       * @param filePath - 插件平台路径；驱动 `readJsonFile()` 的 插件平台步骤。
       */
      readJsonFileSync: (filePath) => readJsonFile(filePath),
      /**
       * 执行 插件平台回调。
       * @param url - 访问地址；影响 requestArrayBuffer 的返回值。
       * @param options - 插件平台列表；影响 requestArrayBuffer 的返回值。
       */
      requestArrayBuffer: async (url, options) => ({
        body: await this.httpClient.requestBuffer({
          context: 'BangDream 资源下载',
          /**
           * 执行 插件平台回调。
           * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
           */
          failureMessage: (statusCode) =>
            `BangDream 资源下载失败：${statusCode}`,
          timeoutMessage: 'BangDream 资源下载超时',
          timeoutMs: options?.timeoutMs,
          url,
        }),
      }),
      /**
       * 执行 插件平台回调。
       * @param url - 访问地址；影响 requestJson 的返回值。
       * @param options - 插件平台列表；影响 requestJson 的返回值。
       */
      requestJson: async (url, options) => ({
        body: await this.httpClient.requestJson({
          context: 'BangDream 数据接口',
          /**
           * 执行 插件平台回调。
           * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
           */
          failureMessage: (statusCode) =>
            `BangDream 数据接口失败：${statusCode}`,
          invalidJsonMessage: 'BangDream 数据接口返回不是合法 JSON',
          timeoutMessage: 'BangDream 数据接口请求超时',
          timeoutMs: options?.timeoutMs,
          url,
        }),
      }),
      /**
       * 执行 插件平台回调。
       * @param ms - 等待毫秒数；驱动 `Promise()` 的 插件平台步骤。
       */
      sleep: async (ms) =>
        await new Promise((resolve) => setTimeout(resolve, ms)),
      /**
       * 执行 插件平台回调。
       * @param filePath - 插件平台路径；驱动 `writeFileSync()` 的 插件平台步骤。
       * @param data - 业务数据；承载 插件平台新增、更新、导入或执行字段。
       */
      writeJsonFile: async (filePath, data) =>
        writeFileSync(filePath, JSON.stringify(data)),
    };
  }

  /**
   * 加载Manifest。
   * @param pluginKey - pluginKey 输入；驱动 `this.resolvePluginRoot()` 的 插件平台步骤。
   * @returns QQBot 插件平台产出的 QqbotPluginManifest。
   */
  private loadManifest(pluginKey: string): QqbotPluginManifest {
    const pluginRoot = this.resolvePluginRoot(pluginKey);
    return parseQqbotPluginManifest(
      readJsonFile(join(pluginRoot, 'plugin.json')),
      { pluginRoot },
    );
  }

  /**
   * 解析Known Ff14 World。
   * @param candidate - candidate 输入；驱动 `splitFf14WorldPath()` 的 插件平台步骤。
   */
  private async resolveKnownFf14World(candidate: string) {
    const catalog = await this.loadFf14MarketCatalog();
    if (!isFf14LocationName(catalog, candidate)) return null;
    const worldPath = splitFf14WorldPath(candidate);
    return { serverSlug: worldPath.world || candidate };
  }

  /**
   * 加载Ff14 Market Catalog。
   */
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

  /**
   * 解析Plugin Root。
   * @param pluginKey - pluginKey 输入；影响 resolvePluginRoot 的返回值。
   */
  private resolvePluginRoot(pluginKey: string) {
    const sourceRoot = join(
      process.cwd(),
      `src/modules/qqbot/plugins/${pluginKey}`,
    );
    if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
    return join(__dirname, `../../../../plugins/${pluginKey}`);
  }
}

/**
 * 读取 QQBot 插件平台资源。
 * @param filePath - 插件平台路径；转换 JSON 文本。
 */
function readJsonFile<T = unknown>(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

/**
 * 读取 QQBot 插件平台资源。
 * @param filePath - 插件平台路径；驱动 `XLSX.readFile()` 的 插件平台步骤。
 */
function readExcelRows<T extends Record<string, unknown>>(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(worksheet);
}

/**
 * 创建 QQBot 插件平台对象或配置。
 * @param input - input 输入；使用 `failureMessageTemplate` 字段生成结果。
 * @param fallbackFailureMessage - fallbackFailureMessage 输入；生成 插件平台对象。
 */
function createWorkerHttpRequest(
  input: Record<string, any> = {},
  fallbackFailureMessage?: (statusCode: number) => string,
) {
  const failureMessageTemplate =
    typeof input.failureMessageTemplate === 'string'
      ? input.failureMessageTemplate
      : undefined;
  const { url, ...rest } = input;
  delete rest.failureMessageTemplate;
  return {
    ...rest,
    failureMessage: failureMessageTemplate
      ? (statusCode: number) =>
          failureMessageTemplate.replaceAll('{statusCode}', `${statusCode}`)
      : fallbackFailureMessage,
    url,
  };
}
