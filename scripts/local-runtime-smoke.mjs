import mysql from 'mysql2/promise';

const FIXTURE_ID = '2041700000000399999';
const FIXTURE_DEDUPE_KEY = 'local-smoke:message-center';

/**
 * 读取本地烟测必需的环境变量，避免请求或数据库连接落到隐式目标。
 * @param {string} name - 需要读取的环境变量名。
 * @returns {string} 环境变量原始值。
 * @throws 当变量缺失或为空时抛出配置错误。
 */
function readRequiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`本地烟测缺少 ${name}`);
  }
  return value;
}

/**
 * 构造只访问当前隔离本地库的 MySQL 连接参数。
 * @returns {import('mysql2/promise').ConnectionOptions} 带大整数无损读取的连接参数。
 * @throws 当端口不是有效 TCP 端口时抛出配置错误。
 */
function createConnectionOptions() {
  const port = Number(readRequiredEnvironment('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT 必须是 1 到 65535 之间的整数');
  }
  return {
    bigNumberStrings: true,
    connectTimeout: 5_000,
    database: readRequiredEnvironment('DB_DATABASE'),
    host: readRequiredEnvironment('DB_HOST'),
    password: readRequiredEnvironment('DB_PASSWORD'),
    port,
    supportBigNumbers: true,
    user: readRequiredEnvironment('DB_USERNAME'),
  };
}

/**
 * 发送本地 API JSON 请求并统一校验 HTTP 状态、响应 JSON 与 Vben 业务码。
 * @param {string} baseUrl - 当前本地 API 根地址。
 * @param {string} pathname - 不含 Origin 的接口路径。
 * @param {RequestInit} [init] - Fetch 请求选项。
 * @returns {Promise<unknown>} Vben 响应中的 `data` 字段。
 * @throws 当 HTTP、JSON 或业务码不成功时抛出包含接口路径的错误。
 */
async function requestJson(baseUrl, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} 未返回 JSON：HTTP ${response.status}`);
  }
  if (!response.ok || payload?.code !== 200) {
    throw new Error(
      `${pathname} 请求失败：HTTP ${response.status} / code ${payload?.code}`,
    );
  }
  return payload.data;
}

/**
 * 从 SSE 缓冲区取出一条完整事件，并把尚未形成事件的尾部留给后续数据块。
 * @param {{ value: string }} state - 跨数据块保留的 SSE 文本状态。
 * @returns {{ data: unknown, id: string, type: string } | undefined} 已解析事件；缓冲不足时返回 `undefined`。
 */
function takeSseEvent(state) {
  const separator = state.value.search(/\r?\n\r?\n/u);
  if (separator === -1) return undefined;

  const matchedSeparator = state.value.slice(separator).match(/^\r?\n\r?\n/u);
  if (!matchedSeparator) return undefined;
  const frame = state.value.slice(0, separator);
  state.value = state.value.slice(separator + matchedSeparator[0].length);
  const dataLines = [];
  let id = '';
  let type = '';
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    }
  }
  const dataText = dataLines.join('\n');
  let data = dataText;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }
  return { data, id, type };
}

/**
 * 在有界时间内读取一块 SSE 响应数据，避免长连接故障让本地验证无限等待。
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader - SSE 响应读取器。
 * @param {number} timeoutMs - 单次读取最长等待毫秒数。
 * @returns {Promise<ReadableStreamReadResult<Uint8Array>>} 一次流读取结果。
 * @throws 当等待超时或连接提前结束时抛出长连接错误。
 */
async function readSseChunk(reader, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`SSE 事件等待超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([reader.read(), timeout]);
    if (result.done) throw new Error('SSE 连接提前结束');
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 持续解析 SSE 数据块，直到收到指定事件类型或达到单次读取超时。
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader - SSE 响应读取器。
 * @param {{ value: string }} state - 跨块文本缓冲区。
 * @param {string} expectedType - 需要等待的事件类型。
 * @returns {Promise<{ data: unknown, id: string, type: string }>} 匹配类型的 SSE 事件。
 * @throws 当连接超时、结束或响应无法继续读取时抛出错误。
 */
async function waitForSseEvent(reader, state, expectedType) {
  const decoder = new TextDecoder();
  for (;;) {
    let event = takeSseEvent(state);
    while (event) {
      if (event.type === expectedType) return event;
      event = takeSseEvent(state);
    }
    const chunk = await readSseChunk(reader, 8_000);
    state.value += decoder.decode(chunk.value, { stream: true });
  }
}

/**
 * 在专用本地库中写入一条未读站内信 fixture，并先移除同 ID 或去重键的旧残留。
 * @param {import('mysql2/promise').Connection} connection - 本次烟测数据库连接。
 * @returns {Promise<void>} fixture 持久化完成后结束。
 */
async function insertNoticeFixture(connection) {
  await connection.execute(
    'DELETE FROM admin_notice WHERE id = ? OR dedupe_key = ?',
    [FIXTURE_ID, FIXTURE_DEDUPE_KEY],
  );
  await connection.execute(
    `INSERT INTO admin_notice (
       id, title, content, summary, level, status, severity, source,
       event_type, dedupe_key, occurrence_count, notify_role_code,
       metadata, is_top, is_deleted, first_seen_at, last_seen_at
     ) VALUES (?, ?, ?, ?, 1, 1, 'info', 'local-smoke', ?, ?, 1, 'super', ?, 0, 0, NOW(6), NOW(6))`,
    [
      FIXTURE_ID,
      '本地消息中心烟测',
      '用于验证未读 Badge、批量已读和 SSE 长连接。',
      'local smoke',
      'local.message-center.smoke',
      FIXTURE_DEDUPE_KEY,
      JSON.stringify({ disposable: true }),
    ],
  );
}

/**
 * 运行真实登录、未读计数、别名路由、批量已读和 SSE 变更事件烟测，并清理唯一 fixture。
 * @returns {Promise<void>} 全部断言通过且 fixture 清理完成后结束。
 * @throws 当任一真实接口、事件或数据库断言不满足时抛出错误。
 */
async function runLocalSmoke() {
  const baseUrl = readRequiredEnvironment('KT_LOCAL_API_BASE_URL').replace(
    /\/$/u,
    '',
  );
  const localAdminPassword = readRequiredEnvironment('KT_LOCAL_ADMIN_PASSWORD');
  const connection = await mysql.createConnection(createConnectionOptions());
  const abortController = new AbortController();
  let reader;
  try {
    const healthResponse = await fetch(`${baseUrl}/health/runtime`);
    if (!healthResponse.ok) {
      throw new Error(`运行态健康接口返回 HTTP ${healthResponse.status}`);
    }
    const health = await healthResponse.json();
    if (health.service !== 'kt-template-online-api') {
      throw new Error('运行态健康接口没有返回预期服务身份');
    }

    const login = await requestJson(baseUrl, '/auth/login', {
      body: JSON.stringify({
        password: localAdminPassword,
        username: 'kwitsukasa',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const accessToken = login?.accessToken;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('本地登录没有返回 accessToken');
    }
    const authorization = `Bearer ${accessToken}`;
    const baseline = await requestJson(baseUrl, '/system/notice/unread-count', {
      headers: { authorization },
    });
    await insertNoticeFixture(connection);
    const withFixture = await requestJson(
      baseUrl,
      '/system/notice/unread-count',
      { headers: { authorization } },
    );
    if (withFixture.count !== baseline.count + 1) {
      throw new Error('写入 fixture 后未读数量没有精确增加 1');
    }

    const aliasCount = await requestJson(
      baseUrl,
      '/message-management/subscribers/station-notice/notices/unread-count',
      { headers: { authorization } },
    );
    if (aliasCount.count !== withFixture.count) {
      throw new Error('消息管理别名路由与消息中心未读数量不一致');
    }

    const streamResponse = await fetch(
      `${baseUrl}/system/notice/events/stream`,
      {
        headers: { accept: 'text/event-stream', authorization },
        signal: abortController.signal,
      },
    );
    if (!streamResponse.ok || !streamResponse.body) {
      throw new Error(`SSE 建连失败：HTTP ${streamResponse.status}`);
    }
    const contentType = streamResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`SSE Content-Type 不正确：${contentType}`);
    }
    if (streamResponse.headers.get('x-accel-buffering') !== 'no') {
      throw new Error('SSE 缺少 X-Accel-Buffering: no');
    }
    reader = streamResponse.body.getReader();
    const streamState = { value: '' };
    const snapshotEvent = await waitForSseEvent(
      reader,
      streamState,
      'snapshot-required',
    );

    const batchResult = await requestJson(
      baseUrl,
      '/system/notice/read/batch',
      {
        body: JSON.stringify({ ids: [FIXTURE_ID] }),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    if (batchResult.updated !== 1) {
      throw new Error(`批量已读实际更新数量不是 1：${batchResult.updated}`);
    }
    const changeEvent = await waitForSseEvent(
      reader,
      streamState,
      'notice-changed',
    );
    if (changeEvent.data?.reason !== 'read') {
      throw new Error('批量已读后 SSE 未返回 read 变更原因');
    }
    const afterRead = await requestJson(
      baseUrl,
      '/system/notice/unread-count',
      { headers: { authorization } },
    );
    if (afterRead.count !== baseline.count) {
      throw new Error('批量已读后未读数量没有恢复到基线');
    }

    process.stdout.write(
      `${JSON.stringify({
        aliasCount: aliasCount.count,
        baselineUnreadCount: baseline.count,
        batchUpdated: batchResult.updated,
        healthService: health.service,
        realtimeEvent: changeEvent.type,
        snapshotEvent: snapshotEvent.type,
      })}\n`,
    );
  } finally {
    abortController.abort();
    if (reader) {
      await reader.cancel().catch(() => undefined);
    }
    await connection
      .execute('DELETE FROM admin_notice WHERE id = ? OR dedupe_key = ?', [
        FIXTURE_ID,
        FIXTURE_DEDUPE_KEY,
      ])
      .catch(() => undefined);
    await connection.end();
  }
}

await runLocalSmoke().catch((error) => {
  let message = String(error);
  if (error instanceof Error) {
    message = error.message;
  }
  process.stderr.write(`本地消息中心烟测失败：${message}\n`);
  process.exitCode = 1;
});
