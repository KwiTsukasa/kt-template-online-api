import type {
  BilibiliCardHostJsonRequest,
  BilibiliCardPluginHost,
} from '../../domain/bilibili-card.types';

export type BilibiliCardGenericHost = Record<string, unknown>;

/**
 * 创建Bilibili卡片通用主机适配器，并输出固定投影 `getBoundEventPluginKeys`、`getConfig`、`requestJson`、`resolveRedirect`、`sendText` 字段。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param configSnapshot - 用于Bilibili卡牌宿主Adapter的领域对象，包含 `key` 字段。
 * @returns 包含 `getBoundEventPluginKeys`、`getConfig`、`requestJson`、`resolveRedirect`、`sendText` 字段的Bilibili卡牌宿主Adapter。
 */
export function createBilibiliCardGenericHostAdapter(
  host: BilibiliCardGenericHost,
  configSnapshot: Record<string, string | undefined>,
): BilibiliCardPluginHost {
  return {
    getBoundEventPluginKeys: async (selfId) =>
      await callBilibiliCardGenericHost(host, 'getBoundEventPluginKeys', selfId),
    getConfig: <T = string>(key: string) =>
      configSnapshot[key] as T | undefined,
    requestJson: async <T = unknown>(request) =>
      await callBilibiliCardGenericHost<T>(
        host,
        'requestJson',
        serializeBilibiliCardJsonRequest(request),
      ),
    resolveRedirect: async (request) =>
      await callBilibiliCardGenericHost(host, 'resolveRedirect', request),
    sendText: async (input) =>
      await callBilibiliCardGenericHost(host, 'sendText', input),
    warn: (message) => {
      void callBilibiliCardGenericHost(host, 'warn', message).catch(
        () => undefined,
      );
    },
  };
}

/**
 * 执行 Bilibili 卡片宿主回调，并把非 `Error` 拒绝值规范为带稳定消息的异常。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param method - 决定调用Bilibili卡牌宿主内容、边界或目标的 `method` 值。
 * @param args - 决定调用Bilibili卡牌宿主内容、边界或目标的 `args` 值；按调用方给定的顺序传递全部剩余实参。
 * @returns 调用Bilibili卡牌宿主。
 * @throws 当 `typeof fn !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
 */
export async function callBilibiliCardGenericHost<TResult = unknown>(
  host: BilibiliCardGenericHost,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`Bilibili Card generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

/**
 * 将`request`转换为序列化Bilibili卡片JSON请求。
 * @param request - 用于序列化Bilibili卡片JSON请求的当前 HTTP 请求，包含 `context`、`failureMessage`、`invalidJsonMessage`、`method` 字段。
 * @returns 包含 `context`、`failureMessageTemplate`、`invalidJsonMessage`、`method`、`timeoutMessage` 字段的序列化Bilibili卡片JSON请求。
 */
export function serializeBilibiliCardJsonRequest(
  request: BilibiliCardHostJsonRequest,
) {
  const statusPlaceholder = 599;
  return {
    context: request.context,
    failureMessageTemplate: request
      .failureMessage(statusPlaceholder)
      .replaceAll(`${statusPlaceholder}`, '{statusCode}'),
    invalidJsonMessage: request.invalidJsonMessage,
    method: request.method,
    timeoutMessage: request.timeoutMessage,
    timeoutMs: request.timeoutMs,
    url: request.url.toString(),
  };
}
