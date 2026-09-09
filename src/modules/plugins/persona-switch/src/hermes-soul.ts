type HttpResponse = {
  body: Uint8Array;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
};
export type RequestResponse = (
  input: Record<string, unknown>,
) => Promise<HttpResponse>;

/**
 * 经原生 Dashboard 登录读写默认档案 SOUL，仅在管理操作中建立短期会话。
 * @param config - 服务端 Dashboard 地址与认证配置。
 * @param request - 宿主提供的有界 HTTP 能力。
 * @param content - API 期望的人格正文。
 * @throws 配置、认证、写入或核验失败时保留待同步状态。
 */
export async function synchronizeSoul(
  config: Record<string, string | undefined>,
  request: RequestResponse,
  content: string,
): Promise<void> {
  const base = config.HERMES_DASHBOARD_BASE_URL;
  const username = config.HERMES_DASHBOARD_USERNAME;
  const password = config.HERMES_DASHBOARD_PASSWORD;
  if (!base || !username || !password)
    throw new Error('Hermes 人格同步配置未就绪。');
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('Hermes Dashboard 地址必须使用 HTTP 或 HTTPS。');
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error('Hermes Dashboard 地址必须为不带路径的服务地址。');
  }
  const cookies = new Map<string, string>();
  const call = async (path: string, method: string, body?: unknown) => {
    const headers: Record<string, string> = {
      Origin: origin.origin,
      'Content-Type': 'application/json',
    };
    if (cookies.size)
      headers.Cookie = Array.from(
        cookies,
        ([key, value]) => `${key}=${value}`,
      ).join('; ');
    const options: Record<string, unknown> = {
      url: new URL(path, origin).toString(),
      method,
      headers,
      timeoutMs: 4000,
      maxResponseBytes: 64 * 1024,
      context: 'Hermes 人格同步',
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await request(options);
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw new Error('Hermes 人格接口未确认成功。');
    const received = response.headers['set-cookie'];
    let cookieLines: string[] = [];
    if (typeof received === 'string') cookieLines = [received];
    else if (Array.isArray(received)) cookieLines = received;
    for (const line of cookieLines) {
      const pair = line.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0)
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return JSON.parse(Buffer.from(response.body).toString('utf8')) as Record<
      string,
      unknown
    >;
  };
  const login = await call('/auth/password-login', 'POST', {
    provider: 'basic',
    username,
    password,
    next: '/',
  });
  if (login.ok !== true || cookies.size === 0)
    throw new Error('Hermes Dashboard 登录失败。');
  const path = '/api/profiles/default/soul';
  const before = await call(path, 'GET');
  if (typeof before.content !== 'string' || typeof before.exists !== 'boolean')
    throw new Error('Hermes SOUL 响应无效。');
  if (before.content === content && before.exists) return;
  const result = await call(path, 'PUT', { content });
  if (result.ok !== true) throw new Error('Hermes SOUL 写入未确认。');
  const after = await call(path, 'GET');
  if (after.exists !== true || after.content !== content)
    throw new Error('Hermes SOUL 读回不一致。');
}
