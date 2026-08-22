import { Ff14MarketApplication } from './application/ff14-market-application';
import {
  Ff14MarketClient,
  type Ff14MarketPluginHost,
} from './infrastructure/integration/ff14-market-client';
import {
  buildFf14MarketOperations,
  type Ff14MarketManifest,
} from './operations';

type Ff14MarketPluginOptions = {
  host: import('./infrastructure/integration/ff14-market-client').Ff14MarketPluginHost;
  manifest: Ff14MarketManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

type PluginGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: Ff14MarketManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type Ff14MarketPluginCreateOptions =
  | Ff14MarketPluginOptions
  | PluginGenericPluginCreateOptions;

/**
 * 根据`options`构造FF14 市场运行时插件；当 `isFf14GenericPluginCreateOptions(options)` 成立时返回 `buildFf14MarketPlugin({ host: createFf14Mar…`。
 * @param options - 控制FF14 市场运行时插件筛选、缓存或输出方式的可选项，包含 `manifest`、`normalizeError`、`now` 字段。
 * @returns 返回按运行时选项构建的插件实例。
 */
export function createPlugin(options: Ff14MarketPluginCreateOptions) {
  if (isFf14GenericPluginCreateOptions(options)) {
    return buildFf14MarketPlugin({
      host: createFf14MarketGenericHostAdapter(options),
      manifest: normalizeFf14MarketManifest(options.manifest),
      normalizeError: (error, fallback) =>
        normalizeFf14MarketGenericError(
          options.normalizeError,
          error,
          fallback,
        ),
      now: options.now,
    });
  }
  return buildFf14MarketPlugin(options);
}

/**
 * 根据`options`构造FF14市场插件。
 * @param options - 控制FF14市场插件筛选、缓存或输出方式的可选项，包含 `host`、`manifest`、`now`、`normalizeError` 字段。
 * @returns 包含 `description`、`healthCheck`、`key`、`legacyKeys`、`name` 字段的FF14市场插件。
 */
function buildFf14MarketPlugin(options: Ff14MarketPluginOptions) {
  const application = new Ff14MarketApplication(
    new Ff14MarketClient(options.host),
  );

  return {
    description: options.manifest.description,
    healthCheck: async () => {
      const checkedAt = formatFf14CheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FF14 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FF14 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFf14MarketOperations(
      application,
      options.manifest.operations,
    ),
    version: options.manifest.version,
  };
}

/**
 * 根据`options`与当前约束判定FF14通用插件创建选项。
 * @param options - 控制FF14通用插件创建选项筛选、缓存或输出方式的可选项。
 * @returns 满足FF14通用插件创建选项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isFf14GenericPluginCreateOptions(
  options: Ff14MarketPluginCreateOptions,
): options is PluginGenericPluginCreateOptions {
  return (
    !!(options as PluginGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as PluginGenericPluginCreateOptions).manifest
  );
}

/**
 * 规范化FF14市场清单，并输出固定投影 `pluginKey` 字段。
 * @param manifest - 用于Ff14市场数据清单的领域对象，包含 `pluginKey`、`key` 字段。
 * @returns 包含 `pluginKey` 字段的Ff14市场数据清单。
 */
function normalizeFf14MarketManifest(
  manifest: PluginGenericPluginCreateOptions['manifest'],
): Ff14MarketManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'ff14-market',
  };
}

/**
 * 创建FF14市场通用主机适配器，并输出固定投影 `getConfig`、`getDictItemsByKey`、`relationTree`、`requestJson` 字段。
 * @param options - 控制Ff14市场数据宿主Adapter筛选、缓存或输出方式的可选项。
 * @returns 包含 `getConfig`、`getDictItemsByKey`、`relationTree`、`requestJson` 字段的Ff14市场数据宿主Adapter；没有可用结果或提前结束时为 `undefined`。
 */
function createFf14MarketGenericHostAdapter(
  options: PluginGenericPluginCreateOptions,
): Ff14MarketPluginHost {
  const { host, runtime } = options;
  return {
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    getDictItemsByKey: async (dictCode) =>
      await callFf14GenericHost(host, 'getDictItemsByKey', dictCode),
    relationTree: async (input) =>
      await callFf14GenericHost(host, 'relationTree', input),
    requestJson: async <T>(request) =>
      await callFf14GenericHost<T>(
        host,
        'requestJson',
        serializeFf14GenericHttpRequest(request),
      ),
  };
}

/**
 * 执行 FF14 市场宿主回调，并把非 `Error` 拒绝值规范为带稳定消息的异常。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param method - 决定调用Ff14宿主内容、边界或目标的 `method` 值。
 * @param args - 决定调用Ff14宿主内容、边界或目标的 `args` 值；按调用方给定的顺序传递全部剩余实参。
 * @returns 调用Ff14宿主。
 * @throws 当 `typeof fn !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
 */
async function callFf14GenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`FF14 Market generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

/**
 * 将`request`转换为序列化FF14通用HTTP请求。
 * @param request - 用于序列化FF14通用HTTP请求的当前 HTTP 请求，包含 `context`、`failureMessage`、`invalidJsonMessage`、`method` 字段。
 * @returns 包含 `body`、`context`、`failureMessageTemplate`、`headers`、`invalidJsonMessage` 字段的序列化FF14通用HTTP请求；没有可用结果或提前结束时为 `undefined`。
 */
function serializeFf14GenericHttpRequest(
  request: Parameters<Ff14MarketPluginHost['requestJson']>[0],
) {
  const statusPlaceholder = 599;
  return {
    body: undefined,
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    headers: undefined,
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}

/**
 * 将`normalizeError`、`error`、`fallback`规范为FF14市场通用错误，使等价输入得到一致表示；当 `normalized instanceof Error` 成立时返回 `normalized.message`。
 * @param normalizeError - 负责完成FF14市场通用错误外部交互的受控能力。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 按参数编码并拼接完成的FF14市场通用错误。
 */
function normalizeFf14MarketGenericError(
  normalizeError: PluginGenericPluginCreateOptions['normalizeError'],
  error: unknown,
  fallback: string,
) {
  const normalized = normalizeError(error, fallback);
  if (normalized instanceof Error) {
    return normalized.message;
  }
  return `${normalized}`;
}

/**
 * 将`date`转换为针对FF14 市场插件；从 `date.getFullYear` 读取针对FF14 市场插件。
 * @param date - 用于针对FF14 市场插件的领域对象，包含 `getFullYear`、`getMonth`、`getDate`、`getHours` 字段。
 * @returns 针对FF14 市场插件。
 */
function formatFf14CheckedAt(date: Date) {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}
