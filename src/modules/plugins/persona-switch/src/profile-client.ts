import type { RequestResponse } from './hermes-soul';

export type Avatar = { hash: string };
export type ProfileJobStatus =
  | 'queued'
  | 'running'
  | 'applied'
  | 'failed'
  | 'needs_login'
  | 'uncertain';
export type ProfileResult = {
  id: string;
  status: ProfileJobStatus;
  detail: string;
};

/**
 * 仅使用服务器配置连接 NAS 执行器，不允许聊天参数改变地址或凭据。
 * @param config - NAS 执行器的地址与服务间令牌。
 * @param request - 宿主提供的有界 HTTP 请求能力。
 * @param path - 固定内部路由。
 * @param body - 写入的结构化数据；省略时读取状态。
 * @returns 执行器返回的经过 HTTP 成功检查的 JSON 数据。
 * @throws 配置、连接、认证或 JSON 响应无效时拒绝继续。
 */
export async function callProfileExecutor(
  config: Record<string, string | undefined>,
  request: RequestResponse,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const base = config.PERSONA_EXECUTOR_BASE_URL;
  const token = config.PERSONA_EXECUTOR_TOKEN;
  if (!base || !token || token.length < 32)
    throw new Error('NAS 人格执行器未配置。');
  const url = new URL(base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('NAS 人格执行器地址无效。');
  let method = 'GET';
  if (body !== undefined) method = 'POST';
  const result = await request({
    url: new URL(path, url).toString(),
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 5000,
    maxResponseBytes: 8192,
    context: 'NAS 人格资料同步',
  });
  if (result.statusCode < 200 || result.statusCode >= 300)
    throw new Error('NAS 人格执行器未确认请求。');
  const value = JSON.parse(Buffer.from(result.body).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('NAS 执行器返回格式无效。');
  return value;
}

/**
 * 验证执行器操作身份和有限状态，避免把无关任务或任意响应当作资料修改成功。
 * @param value - 执行器原始 JSON 响应。
 * @param expectedId - API 持久保存的操作身份。
 * @returns 可写入人格状态的脱敏执行结果。
 * @throws 身份或状态非法时拒绝确认。
 */
export function readProfileResult(
  value: Record<string, unknown>,
  expectedId: string,
): ProfileResult {
  if (
    value.id !== expectedId ||
    ![
      'queued',
      'running',
      'applied',
      'failed',
      'needs_login',
      'uncertain',
    ].includes(String(value.status)) ||
    typeof value.detail !== 'string' ||
    value.detail.length > 200
  )
    throw new Error('NAS 资料操作响应无效。');
  return {
    id: expectedId,
    status: value.status as ProfileJobStatus,
    detail: value.detail,
  };
}
