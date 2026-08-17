import type {
  BilibiliCardHostJsonRequest,
  BilibiliCardPluginHost,
} from '../../domain/bilibili-card.types';

export type BilibiliCardGenericHost = Record<string, unknown>;

/** 创建Bilibili卡片通用主机适配器。 */
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

/** 返回调用Bilibili卡片通用主机。 */
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

/** 序列化Bilibili卡片JSON请求。 */
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
