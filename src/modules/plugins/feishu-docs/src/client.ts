import { createHash } from 'node:crypto';

type Request = (
  input: Record<string, unknown>,
) => Promise<{ body: Uint8Array }>;
type Input = Record<string, any>;
type Target = { kind: string; id: string };

export class FeishuDocuments {
  private token = '';
  private expiresAt = 0;
  constructor(
    private readonly config: Record<string, string | undefined>,
    private readonly request: Request,
  ) {}

  /**
   * 仅通过飞书固定域名发送有界请求，认证信息不会进入结果或上游错误原文。
   * @param path - 实现内构造的开放平台路径。
   * @param method - 当前文档操作要求的请求方式。
   * @param body - 已校验的请求体。
   * @returns 飞书成功响应的数据对象。
   * @throws 凭据缺失、权限不足、限流或服务异常时返回不含密钥的错误。
   */
  private async api(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<any> {
    if (this.expiresAt <= Date.now()) {
      const app_id = this.config.FEISHU_DOCS_APP_ID;
      const app_secret = this.config.FEISHU_DOCS_APP_SECRET;
      if (!app_id || !app_secret)
        throw new Error(
          '飞书应用凭据尚未配置，请联系管理员配置 NAS 私有运行环境。',
        );
      const auth = await this.json(
        '/auth/v3/tenant_access_token/internal',
        'POST',
        { app_id, app_secret },
      );
      if (!auth.tenant_access_token || !(auth.expire > 60))
        throw new Error('飞书未返回有效应用令牌。');
      this.token = auth.tenant_access_token;
      this.expiresAt = Date.now() + (auth.expire - 60) * 1000;
    }
    return (await this.json(path, method, body, this.token)).data;
  }

  /**
   * 校验官方业务状态码，拒绝把错误页或重定向当作文档内容。
   * @param path - 固定官方域内的 API 路径。
   * @param method - HTTP 方法。
   * @param body - 可选结构化请求体。
   * @param token - 当前插件私有的短期应用令牌。
   * @returns 通过业务状态校验的响应。
   * @throws 非成功状态、无效 JSON 或网络失败时停止当前操作，不自动重试写入。
   */
  private async json(
    path: string,
    method: string,
    body?: unknown,
    token?: string,
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (body !== undefined) payload = JSON.stringify(body);
    let response: { body: Uint8Array };
    try {
      response = await this.request({
        url: new URL(`https://open.feishu.cn/open-apis${path}`),
        method,
        headers,
        body: payload,
        timeoutMs: 15000,
        maxResponseBytes: 4 * 1024 * 1024,
        contextLabel: '飞书文档 API',
      });
    } catch (error) {
      const status = Number((error as any)?.statusCode || 0);
      throw new Error(
        `飞书文档请求失败（HTTP ${status || '网络异常'}）；请核对应用已发布、API 权限及目标文档授权。写入未自动重试，请先回读目标。`,
      );
    }
    const result = JSON.parse(Buffer.from(response.body).toString('utf8'));
    if (result.code !== 0) {
      if ([99991663, 99991664, 99991668].includes(result.code))
        this.expiresAt = 0;
      throw new Error(
        `飞书文档 API 返回错误 ${Number(result.code)}；请核对应用身份权限及文档协作者权限。`,
      );
    }
    return result;
  }

  /**
   * 从真实飞书链接解析对象身份，知识库节点通过官方接口换取底层文档标识。
   * @param input - 包含文档 URL 的命令参数。
   * @returns 支持的文档类型及经过格式验证的真实标识。
   * @throws 非飞书链接、未知类型或无效节点时拒绝访问。
   */
  private async target(input: Input): Promise<Target> {
    const url = new URL(String(input.url || ''));
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !/(^|\.)feishu\.cn$/u.test(url.hostname)
    )
      throw new Error('url 必须是飞书 HTTPS 文档链接。');
    const match = /^\/(docx|sheets|wiki|base)\/([A-Za-z0-9]+)\/?$/u.exec(
      url.pathname,
    );
    if (!match) throw new Error('支持飞书 docx、sheets、wiki 与 base 链接。');
    let kind = match[1],
      id = match[2];
    if (kind === 'wiki') {
      const data = await this.api(`/wiki/v2/spaces/get_node?token=${id}`);
      kind = data.node.obj_type;
      id = identifier(data.node.obj_token, '知识库对象');
    }
    if (kind === 'base') kind = 'bitable';
    if (!['docx', 'sheet', 'sheets', 'bitable'].includes(kind))
      throw new Error(`该知识库对象类型暂不支持：${kind}`);
    if (kind === 'sheet') kind = 'sheets';
    return { kind, id };
  }

  /**
   * 按文档类型读取真实块、工作表区域或多维表记录，保留分页游标和可编辑对象标识。
   * @param input - 文档链接及可选块、区域、表和分页游标。
   * @returns 数据、当前快照摘要与下一页游标，供后续精确编辑复核。
   */
  async read(input: Input) {
    const target = await this.target(input);
    const data = await this.readTarget(target, input);
    return {
      provider: 'feishu',
      target,
      source: input.url,
      data,
      snapshot: fingerprint(target, input, data),
      readAt: new Date().toISOString(),
    };
  }

  /**
   * 只读取目标对象的指定区域，块和记录 ID 必须来自上次读取。
   * @param target - 已解析的底层对象。
   * @param input - 当前块、区域、表或分页选项。
   * @returns 官方接口数据，未遍历的分页不会被标记为完成。
   * @throws 区域、标识或游标格式不合法时停止请求。
   */
  private async readTarget(target: Target, input: Input): Promise<any> {
    const cursor = new URLSearchParams({ page_size: '100' });
    if (input.pageToken)
      cursor.set('page_token', String(input.pageToken).slice(0, 1000));
    if (target.kind === 'docx') {
      if (input.blockId)
        return this.api(
          `/docx/v1/documents/${target.id}/blocks/${identifier(input.blockId, '块')}`,
        );
      return this.api(`/docx/v1/documents/${target.id}/blocks?${cursor}`);
    }
    if (target.kind === 'sheets') {
      if (!input.range)
        return this.api(`/sheets/v3/spreadsheets/${target.id}/sheets/query`);
      validateRange(input.range);
      return this.api(
        `/sheets/v2/spreadsheets/${target.id}/values/${encodeURIComponent(input.range)}?valueRenderOption=UnformattedValue`,
      );
    }
    if (!input.tableId)
      return this.api(`/bitable/v1/apps/${target.id}/tables?${cursor}`);
    const base = `/bitable/v1/apps/${target.id}/tables/${identifier(input.tableId, '数据表')}/records`;
    if (input.recordId)
      return this.api(`${base}/${identifier(input.recordId, '记录')}`);
    return this.api(`${base}?${cursor}`);
  }

  /**
   * 比较最近一次读取摘要后编辑明确块、区域或单条记录，回读一致才确认写入。
   * @param input - 目标、上次读取的 expectedSnapshot 与明确的新值。
   * @returns 写入后实际数据及验证结果；不隐式执行创建、删除或跨文档操作。
   * @throws 快照变化、范围不符、写入异常或回读不一致时拒绝宣称完成。
   */
  async edit(input: Input) {
    if (!/^[a-f0-9]{64}$/u.test(String(input.expectedSnapshot)))
      throw new Error(
        '编辑前先读取目标，将返回的 snapshot 作为 expectedSnapshot。',
      );
    const target = await this.target(input);
    const before = await this.readTarget(target, input);
    if (fingerprint(target, input, before) !== input.expectedSnapshot)
      throw new Error('目标内容已变化，未写入；请重新读取并核对修改。');
    if (target.kind === 'docx') {
      const id = identifier(input.blockId, '待编辑块');
      if (typeof input.text !== 'string' || input.text.length > 10000)
        throw new Error('text 必须是最多 10000 字的块正文。');
      if (!before.block?.text)
        throw new Error('仅支持修改明确的普通文本块，其他块保留原样。');
      await this.api(`/docx/v1/documents/${target.id}/blocks/${id}`, 'PATCH', {
        update_text_elements: {
          elements: [{ text_run: { content: input.text } }],
        },
      });
    } else if (target.kind === 'sheets') {
      const shape = validateRange(input.range);
      validateValues(input.values, shape);
      await this.api(`/sheets/v2/spreadsheets/${target.id}/values`, 'PUT', {
        valueRange: { range: input.range, values: input.values },
      });
    } else {
      const table = identifier(input.tableId, '数据表'),
        record = identifier(input.recordId, '记录');
      if (
        !input.fields ||
        Array.isArray(input.fields) ||
        typeof input.fields !== 'object' ||
        !Object.keys(input.fields).length ||
        JSON.stringify(input.fields).length > 20000
      )
        throw new Error('fields 必须是当前记录明确待修改的字段对象。');
      await this.api(
        `/bitable/v1/apps/${target.id}/tables/${table}/records/${record}`,
        'PUT',
        { fields: input.fields },
      );
    }
    const after = await this.readTarget(target, input);
    let verified = false;
    if (target.kind === 'docx')
      verified =
        after.block?.text?.elements
          ?.map((e: any) => e.text_run?.content || '')
          .join('') === input.text;
    else if (target.kind === 'sheets')
      verified =
        JSON.stringify(after.valueRange?.values) ===
        JSON.stringify(input.values);
    else
      verified = Object.entries(input.fields).every(
        ([key, value]) =>
          JSON.stringify(after.record?.fields?.[key]) === JSON.stringify(value),
      );
    if (!verified)
      throw new Error(
        '请求已提交，但回读与预期不同；请读取目标核对，禁止自动重复写入。',
      );
    return {
      provider: 'feishu',
      target,
      verified,
      data: after,
      snapshot: fingerprint(target, input, after),
      replyText: '已修改指定目标并通过回读核验。',
    };
  }
}

/**
 * 限制对象标识为官方返回的字母数字，禁止把标识拼接成额外 API 路径。
 * @param value - 从链接或读取结果取得的标识。
 * @param label - 错误提示中的对象名称。
 * @returns 已校验标识。
 * @throws 缺失或含路径字符时拒绝请求。
 */
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{1,100}$/u.test(value))
    throw new Error(`${label} ID 无效，请使用读取结果中的 ID。`);
  return value;
}

/**
 * 将带工作表标识的矩形区域换算成有限行列数，禁止隐式整表覆盖。
 * @param range - sheetId!A1:B2 格式的完整区域。
 * @returns 区域内应有的行列数。
 * @throws 范围反向、缺失或超过 2000 格时停止读取和写入。
 */
function validateRange(range: unknown) {
  const match =
    /^([A-Za-z0-9]+)!([A-Z]{1,3})([1-9]\d{0,5}):([A-Z]{1,3})([1-9]\d{0,5})$/u.exec(
      String(range),
    );
  if (!match) throw new Error('range 使用 sheetId!A1:B2，必须明确矩形边界。');
  const column = (text: string) =>
    [...text].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
  const rows = Number(match[5]) - Number(match[3]) + 1,
    columns = column(match[4]) - column(match[2]) + 1;
  if (rows < 1 || columns < 1 || rows * columns > 2000)
    throw new Error('单次区域限 2000 格且起止顺序必须正确。');
  return { rows, columns };
}

/**
 * 拒绝尺寸不符的表格写入，限定单元格为普通值并控制整批正文大小。
 * @param values - 二维单元格数组。
 * @param shape - 目标区域行列数。
 * @throws 尺寸不符、复杂结构或非有限数字时拒绝写入。
 */
function validateValues(
  values: unknown,
  shape: { rows: number; columns: number },
) {
  if (
    !Array.isArray(values) ||
    values.length !== shape.rows ||
    values.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== shape.columns ||
        row.some(
          (cell) =>
            !['string', 'number', 'boolean'].includes(typeof cell) ||
            (typeof cell === 'number' && !Number.isFinite(cell)),
        ),
    ) ||
    JSON.stringify(values).length > 50000
  )
    throw new Error(
      'values 必须与 range 大小一致，且仅含文本、有限数字或布尔值。',
    );
}

/**
 * 将对象及区域绑定到读取内容，防止把另一文档的摘要用于编辑当前目标。
 * @param target - 底层文档身份。
 * @param input - 本次精确选择的块、表、记录或区域。
 * @param data - 实际读取数据。
 * @returns 不包含凭据的内容摘要。
 */
function fingerprint(target: Target, input: Input, data: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        target,
        input.range,
        input.blockId,
        input.tableId,
        input.recordId,
        data,
      ]),
    )
    .digest('hex');
}
