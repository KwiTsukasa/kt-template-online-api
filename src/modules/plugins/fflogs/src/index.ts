import { FflogsApplication } from './application/fflogs-application';
import {
  FflogsClient,
  type FflogsPluginHost,
} from './infrastructure/integration/fflogs-client';
import { buildFflogsOperations, type FflogsManifest } from './operations';

type FflogsPluginOptions = {
  host: import('./infrastructure/integration/fflogs-client').FflogsPluginHost;
  manifest: FflogsManifest;
  normalizeError?: (error: unknown, fallback: string) => string;
  now?: () => Date;
};

type PluginGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: FflogsManifest & { key?: string };
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type FflogsPluginCreateOptions =
  | FflogsPluginOptions
  | PluginGenericPluginCreateOptions;

/**
 * 根据`options`构造FFLogs 运行时插件；当 `isFflogsGenericPluginCreateOptions(options)` 成立时返回 `buildFflogsPlugin({ host: createFflogsGener…`。
 * @param options - 控制FFLogs 运行时插件筛选、缓存或输出方式的可选项，包含 `manifest`、`normalizeError`、`now` 字段。
 * @returns 返回按运行时选项构建的插件实例。
 */
export function createPlugin(options: FflogsPluginCreateOptions) {
  if (isFflogsGenericPluginCreateOptions(options)) {
    return buildFflogsPlugin({
      host: createFflogsGenericHostAdapter(options),
      manifest: normalizeFflogsManifest(options.manifest),
      normalizeError: (error, fallback) =>
        normalizeFflogsGenericError(options.normalizeError, error, fallback),
      now: options.now,
    });
  }
  return buildFflogsPlugin(options);
}

/**
 * 用清单、宿主能力与错误规范化器创建 FFLogs 插件，并装配操作列表与健康检查。
 * @param options - 控制FFLogs插件筛选、缓存或输出方式的可选项，包含 `host`、`manifest`、`now`、`normalizeError` 字段。
 * @returns 包含 `description`、`healthCheck`、`key`、`legacyKeys`、`name` 字段的FFLogs插件。
 */
function buildFflogsPlugin(options: FflogsPluginOptions) {
  const application = new FflogsApplication(new FflogsClient(options.host));
  return {
    description: options.manifest.description,
    healthCheck: async () => {
      const checkedAt = formatFflogsCheckedAt(options.now?.() || new Date());
      try {
        await application.checkHealth();
        return {
          checkedAt,
          message: 'FFLogs 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message:
            options.normalizeError?.(error, 'FFLogs 插件不可用') || `${error}`,
          status: 'degraded',
        };
      }
    },
    key: options.manifest.pluginKey,
    legacyKeys: options.manifest.legacyAliases,
    name: options.manifest.name,
    operations: buildFflogsOperations(application, options.manifest.operations),
    version: options.manifest.version,
  };
}

/**
 * 根据`options`与当前约束判定FFLogs通用插件创建选项。
 * @param options - 控制FFLogs通用插件创建选项筛选、缓存或输出方式的可选项。
 * @returns 满足FFLogs通用插件创建选项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isFflogsGenericPluginCreateOptions(
  options: FflogsPluginCreateOptions,
): options is PluginGenericPluginCreateOptions {
  return (
    !!(options as PluginGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as PluginGenericPluginCreateOptions).manifest
  );
}

/**
 * 规范化FFLogs清单，并输出固定投影 `pluginKey` 字段。
 * @param manifest - 用于Fflogs清单的领域对象，包含 `pluginKey`、`key` 字段。
 * @returns 包含 `pluginKey` 字段的Fflogs清单。
 */
function normalizeFflogsManifest(
  manifest: PluginGenericPluginCreateOptions['manifest'],
): FflogsManifest {
  return {
    ...manifest,
    pluginKey: manifest.pluginKey || manifest.key || 'fflogs',
  };
}

/**
 * 创建FFLogs通用主机适配器，并输出固定投影 `getConfig`、`getDictByKey`、`getDictItemsByKey`、`relationTree`、`requestJson` 字段。
 * @param options - 控制Fflogs宿主Adapter筛选、缓存或输出方式的可选项。
 * @returns 包含 `getConfig`、`getDictByKey`、`getDictItemsByKey`、`relationTree`、`requestJson` 字段的Fflogs宿主Adapter；没有可用结果或提前结束时为 `undefined`。
 */
function createFflogsGenericHostAdapter(
  options: PluginGenericPluginCreateOptions,
): FflogsPluginHost {
  const { host, runtime } = options;
  return {
    getConfig: <T = string>(key: string) =>
      runtime.configSnapshot[key] as T | undefined,
    getDictByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    getDictItemsByKey: async (dictCode) =>
      await callFflogsGenericDictHost(host, dictCode),
    relationTree: async (input) =>
      await callFflogsGenericHost(host, 'relationTree', input),
    requestJson: async <T>(request) =>
      await callFflogsGenericHost<T>(
        host,
        'requestJson',
        serializeFflogsGenericHttpRequest(request),
      ),
  };
}

/**
 * 通过受控桥接获取FFLogs通用字典主机。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param dictCode - 决定通过受控桥接获取FFLogs通用字典主机内容、边界或目标的 `dictCode` 值。
 * @returns 通过受控桥接获取FFLogs通用字典主机。
 */
async function callFflogsGenericDictHost(
  host: Record<string, unknown>,
  dictCode: string,
) {
  const method =
    (() => {
      if (typeof host.getDictItemsByKey === 'function') {
        return 'getDictItemsByKey';
      }
      return 'getDictByKey';
    })();
  return await callFflogsGenericHost(host, method, dictCode);
}

/**
 * 执行 FFLogs 宿主回调，并把非 `Error` 拒绝值规范为带稳定消息的异常。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param method - 决定调用Fflogs宿主内容、边界或目标的 `method` 值。
 * @param args - 决定调用Fflogs宿主内容、边界或目标的 `args` 值；按调用方给定的顺序传递全部剩余实参。
 * @returns 调用Fflogs宿主。
 * @throws 当 `typeof fn !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
 */
async function callFflogsGenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`FFLogs generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

/**
 * 将`request`转换为序列化FFLogs通用HTTP请求。
 * @param request - 用于序列化FFLogs通用HTTP请求的当前 HTTP 请求，包含 `body`、`context`、`failureMessage`、`headers` 字段。
 * @returns 包含 `body`、`context`、`failureMessageTemplate`、`headers`、`invalidJsonMessage` 字段的序列化FFLogs通用HTTP请求。
 */
function serializeFflogsGenericHttpRequest(
  request: Parameters<FflogsPluginHost['requestJson']>[0],
) {
  const statusPlaceholder = 599;
  return {
    body: request.body,
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    headers: request.headers,
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}

/**
 * 将`normalizeError`、`error`、`fallback`规范为FFLogs通用错误，使等价输入得到一致表示；当 `normalized instanceof Error` 成立时返回 `normalized.message`。
 * @param normalizeError - 负责完成FFLogs通用错误外部交互的受控能力。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 按参数编码并拼接完成的FFLogs通用错误。
 */
function normalizeFflogsGenericError(
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
 * 将日期按本地时区格式化为补零的秒级检查时间，供 FFLogs 插件状态摘要展示。
 * @param date - 要显示的检查时间，按其本地年月日与时分秒读取。
 * @returns `YYYY-MM-DD HH:mm:ss` 格式的本地时间文本。
 */
function formatFflogsCheckedAt(date: Date) {
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
