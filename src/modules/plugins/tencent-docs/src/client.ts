import { createHash } from 'node:crypto';

type Input = Record<string, any>;
type Request = (input: Record<string, unknown>) => Promise<{
  body: Uint8Array;
  headers?: Record<string, string | string[] | undefined>;
}>;
type Service = 'general' | 'doc' | 'sheet';
type Target = { id: string; kind: string; url: string; title: string };

const endpoints: Record<Service, string> = {
  general: '/openapi/mcp',
  doc: '/api/v6/doc/mcp',
  sheet: '/api/v6/sheet/mcp',
};

export class TencentDocuments {
  private readonly sessions = new Map<Service, string>();
  private sequence = 0;
  constructor(
    private readonly token: string | undefined,
    private readonly request: Request,
  ) {}

  /**
   * 通过腾讯官方各品类端点调用固定工具，认证和会话仅属于本插件。
   * @param service - 文档类型对应的官方服务。
   * @param name - 实现中固定的工具名，不能由用户任意指定。
   * @param args - 经过目标和范围校验的业务参数。
   * @returns 官方结构化结果；错误不会被当作成功内容。
   * @throws 认证、协议或业务失败时返回不含令牌的错误，不重试写入。
   */
  private async call(
    service: Service,
    name: string,
    args: Input,
  ): Promise<any> {
    if (!this.sessions.has(service)) {
      await this.rpc(service, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'KT Tencent Docs', version: '1.0.0' },
      });
      await this.rpc(service, 'notifications/initialized', {}, true);
      if (!this.sessions.has(service)) this.sessions.set(service, '');
    }
    const result = await this.rpc(service, 'tools/call', {
      name,
      arguments: args,
    });
    let data = result.structuredContent;
    if (!data) {
      const text = result.content?.find(
        (item: Input) => item.type === 'text',
      )?.text;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('腾讯文档未返回可核验的结构化结果。');
      }
    }
    if (
      result.isError ||
      data.error ||
      (data.code !== undefined && Number(data.code) !== 0)
    )
      throw new Error(
        `腾讯文档操作未成功（${Number(data.code || data.error?.code) || '权限或业务错误'}）；请核对账号授权、文档权限及服务额度，写入未自动重试。`,
      );
    return data;
  }

  /**
   * 发送有界 MCP 请求，兼容官方 JSON 与 SSE 响应并绑定请求编号。
   * @param service - 固定腾讯服务键。
   * @param method - 初始化、通知或工具调用方法。
   * @param params - 当前协议参数。
   * @param notification - 是否为不期待返回内容的初始化通知。
   * @returns 与当前编号匹配的协议结果。
   * @throws 无令牌、网络失败、响应越界或协议错误时停止当前操作。
   */
  private async rpc(
    service: Service,
    method: string,
    params: Input,
    notification = false,
  ): Promise<any> {
    if (!this.token || /[\r\n]/u.test(this.token))
      throw new Error(
        '腾讯文档令牌尚未配置，请在 NAS 私有环境配置 TENCENT_DOCS_TOKEN。',
      );
    const headers: Record<string, string> = {
      Authorization: this.token,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };
    const session = this.sessions.get(service);
    if (session) headers['Mcp-Session-Id'] = session;
    const body: Input = { jsonrpc: '2.0', method, params };
    if (!notification) body.id = ++this.sequence;
    let response: Awaited<ReturnType<Request>>;
    try {
      response = await this.request({
        url: `https://docs.qq.com${endpoints[service]}`,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        timeoutMs: 20000,
        maxResponseBytes: 4 * 1024 * 1024,
        context: '腾讯文档官方 API',
      });
    } catch {
      this.sessions.delete(service);
      throw new Error(
        '腾讯文档请求失败；请核对 NAS 网络与账号授权。写入未自动重试，请先回读目标。',
      );
    }
    const sessionId = response.headers?.['mcp-session-id'];
    if (typeof sessionId === 'string') this.sessions.set(service, sessionId);
    if (notification) return {};
    const raw = Buffer.from(response.body).toString('utf8');
    let envelope: Input | undefined;
    try {
      envelope = JSON.parse(raw);
    } catch {
      for (const line of raw.split(/\r?\n/u)) {
        if (!line.startsWith('data:')) continue;
        try {
          const candidate = JSON.parse(line.slice(5));
          if (candidate.id === body.id) envelope = candidate;
        } catch {
          /* SSE 心跳和非 JSON 行不作为业务结果。 */
        }
      }
    }
    if (
      !envelope ||
      envelope.id !== body.id ||
      envelope.error ||
      !envelope.result
    ) {
      this.sessions.delete(service);
      throw new Error(
        `腾讯文档协议未确认成功（${Number(envelope?.error?.code) || '响应无效'}）。`,
      );
    }
    return envelope.result;
  }

  /**
   * 把真实腾讯链接交给官方元信息接口解析，不推算内部文件 ID。
   * @param input - 用户提供的文档链接。
   * @returns 官方返回的文件身份和类型。
   * @throws 非腾讯链接、无权限或返回身份无效时拒绝操作。
   */
  private async target(input: Input): Promise<Target> {
    const url = new URL(String(input.url || ''));
    const path =
      /^\/(doc|sheet|slide|smartsheet|smartcanvas|mind|flowchart|form)\/([A-Za-z0-9_-]+)\/?$/u.exec(
        url.pathname,
      );
    if (
      url.origin !== 'https://docs.qq.com' ||
      url.username ||
      url.password ||
      !path
    )
      throw new Error('url 必须是腾讯文档的 HTTPS 文档链接。');
    const data = await this.call('general', 'manage.query_file_info', {
      file_id: path[2],
    });
    if (
      typeof data.file_id !== 'string' ||
      !/^[A-Za-z0-9_$-]{1,150}$/u.test(data.file_id) ||
      !data.type
    )
      throw new Error('腾讯文档未返回有效文件身份。');
    return {
      id: data.file_id,
      kind: data.type,
      url: input.url,
      title: data.title || '',
    };
  }

  /**
   * 读取指定区域或正文，元信息、检索位置和内容快照各自保持明确用途。
   * @param target - 官方确认的文件身份。
   * @param input - 工作表区域或正文分页选项。
   * @returns 用于内容校验的稳定数据，不保留每次变化的追踪编号。
   * @throws 官方服务未返回正文时停止读取，防止空结果成为可写快照。
   */
  private async inspect(target: Target, input: Input): Promise<any> {
    if (target.kind === 'sheet') {
      if (!input.sheetId) {
        const data = await this.call('sheet', 'get_sheet_info', {
          file_id: target.id,
        });
        return { sheets: data.sheets };
      }
      const area = sheetArea(input);
      const data = await this.call('sheet', 'get_cell_data', {
        file_id: target.id,
        sheet_id: input.sheetId,
        ...area,
        return_csv: false,
        include_formula: true,
      });
      return { cells: data.cells || [] };
    }
    const data = await this.call('general', 'get_content', {
      file_id: target.id,
    });
    if (typeof data.content !== 'string')
      throw new Error('腾讯文档未返回正文。');
    const content: Input = { content: data.content };
    if (target.kind === 'doc') {
      const version = await this.call('doc', 'get_last_operable_pos', {
        file_id: target.id,
      });
      content.version = version.version;
    }
    return content;
  }

  /**
   * 读取正文或有限表格区域；正文分页不会丢失总长度和继续位置。
   * @param input - 文档链接、可选工作表区域、查找原文及分页位置。
   * @returns 内容、真实 ID、后续分页和编辑需要的快照。
   * @throws 分页越界或原文检索参数无效时拒绝请求。
   */
  async read(input: Input) {
    const offset = Number(input.offset || 0),
      limit = Number(input.limit || 12000);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 100 ||
      limit > 20000
    )
      throw new Error('offset 必须非负，limit 范围 100 至 20000。');
    const target = await this.target(input);
    const data = await this.inspect(target, input);
    const result: Input = {
      provider: 'tencent',
      target,
      snapshot: fingerprint(target, input, data),
      data,
    };
    if (typeof data.content === 'string') {
      result.data = {
        ...data,
        content: data.content.slice(offset, offset + limit),
      };
      result.totalCharacters = data.content.length;
      result.hasMore = offset + limit < data.content.length;
      result.nextOffset = Math.min(offset + limit, data.content.length);
    }
    if (input.findText && target.kind === 'doc') {
      plainText(input.findText);
      const found = await this.call('doc', 'find', {
        file_id: target.id,
        text: input.findText,
      });
      result.matches = found.text_and_locations || [];
    }
    return result;
  }

  /**
   * 编辑明确原文的一处匹配或指定矩形区域，复核快照并在写后重新读取。
   * @param input - 上次快照、文档原文和新文，或工作表区域与二维值。
   * @returns 只有目标内容经过实际回读比对才返回 verified。
   * @throws 内容已变化、原文不唯一、范围无效、版本缺失或核验失败时停止。
   */
  async edit(input: Input) {
    if (!/^[a-f0-9]{64}$/u.test(String(input.expectedSnapshot)))
      throw new Error('请先读取目标并提供 expectedSnapshot。');
    const target = await this.target(input);
    if (!['doc', 'sheet'].includes(target.kind))
      throw new Error(
        '当前精确编辑支持 Word 文档和 Excel 表格；其他类型已提供读取能力。',
      );
    const before = await this.inspect(target, input);
    if (fingerprint(target, input, before) !== input.expectedSnapshot)
      throw new Error('目标内容已变化，未写入；请重新读取并核对修改。');
    let verifyTextAt: number | undefined;
    let desiredCells: Input[] = [];
    if (target.kind === 'doc') {
      plainText(input.oldText);
      plainText(input.text);
      const version = Number(before.version);
      if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647)
        throw new Error('未取得可用于精确编辑的文档版本。');
      const found = await this.call('doc', 'find', {
        file_id: target.id,
        text: input.oldText,
        version_info: { base_version: version },
      });
      let matches = (found.text_and_locations || []).map(
        (item: Input) => item.range,
      );
      if (input.begin !== undefined)
        matches = matches.filter((range: Input) => range.begin === input.begin);
      if (matches.length !== 1)
        throw new Error(
          '原文未找到或存在多处匹配；请读取 findText 结果并用 begin 指定一处。',
        );
      const range = matches[0];
      if (
        !Number.isSafeInteger(range.begin) ||
        !Number.isSafeInteger(range.end) ||
        range.end <= range.begin
      )
        throw new Error('官方返回的原文范围无效。');
      verifyTextAt = range.begin;
      await this.call('doc', 'replace_text', {
        file_id: target.id,
        ranges: [range],
        text: input.text,
        version_info: { base_version: version },
      });
    } else {
      const area = sheetArea(input);
      const rows = area.end_row - area.start_row,
        columns = area.end_col - area.start_col;
      if (
        !Array.isArray(input.values) ||
        input.values.length !== rows ||
        input.values.some(
          (row: any) => !Array.isArray(row) || row.length !== columns,
        )
      )
        throw new Error('values 必须与指定矩形大小一致。');
      desiredCells = input.values.flatMap((row: unknown[], r: number) =>
        row.map((value, c) =>
          cellValue(area.start_row + r, area.start_col + c, value),
        ),
      );
      if (JSON.stringify(desiredCells).length > 100000)
        throw new Error('单次单元格文本超过大小限制。');
      await this.call('sheet', 'set_range_value', {
        file_id: target.id,
        sheet_id: input.sheetId,
        values: desiredCells,
      });
    }
    const after = await this.inspect(target, input);
    let verified = false;
    if (target.kind === 'doc') {
      const found = await this.call('doc', 'find', {
        file_id: target.id,
        text: input.text,
      });
      verified = (found.text_and_locations || []).some(
        (item: Input) => item.range?.begin === verifyTextAt,
      );
    } else {
      verified = desiredCells.every((expected) => {
        const actual = after.cells.find(
          (cell: Input) =>
            cell.row === expected.row && cell.col === expected.col,
        );
        return (
          actual &&
          Object.entries(expected).every(
            ([key, value]) => actual[key] === value,
          )
        );
      });
    }
    if (!verified)
      throw new Error(
        '请求已提交，但回读未匹配预期；请核对目标，禁止自动重复写入。',
      );
    return {
      provider: 'tencent',
      target,
      verified,
      snapshot: fingerprint(target, input, after),
      replyText: '已修改指定目标并通过回读核验。',
    };
  }
}

/**
 * 校验腾讯表格的零基矩形边界，结束位置不包含在区域内。
 * @param input - 工作表 ID 和明确的四个边界。
 * @returns 官方接口使用的矩形参数。
 * @throws 无真实工作表 ID、边界反向或超过两千格时拒绝操作。
 */
function sheetArea(input: Input) {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(String(input.sheetId || '')))
    throw new Error('请先读取真实 sheetId。');
  const { startRow, endRow, startCol, endCol } = input;
  if (![startRow, endRow, startCol, endCol].every(Number.isSafeInteger))
    throw new Error('矩形边界必须为整数。');
  if (startRow < 0 || startCol < 0 || endRow <= startRow || endCol <= startCol)
    throw new Error('请明确零基矩形，结束位置不包含在内。');
  if (
    endRow > 1000000 ||
    endCol > 16384 ||
    (endRow - startRow) * (endCol - startCol) > 2000
  )
    throw new Error('请明确零基矩形，结束位置不包含在内，单次限 2000 格。');
  return {
    start_row: startRow,
    end_row: endRow,
    start_col: startCol,
    end_col: endCol,
  };
}

/**
 * 把普通单元格值映射为官方类型，不把任意对象或公式当作文字发送。
 * @param row - 真实行索引。
 * @param col - 真实列索引。
 * @param value - 用户明确的新值。
 * @returns 仅含当前类型所需字段的单元格。
 * @throws 非文本、有限数字或布尔值时拒绝写入。
 */
function cellValue(row: number, col: number, value: unknown): Input {
  if (typeof value === 'string')
    return { row, col, value_type: 'STRING', string_value: value };
  if (typeof value === 'number' && Number.isFinite(value))
    return { row, col, value_type: 'NUMBER', number_value: value };
  if (typeof value === 'boolean')
    return { row, col, value_type: 'BOOL', bool_value: value };
  throw new Error('单元格只接受文本、有限数字和布尔值。');
}

/**
 * 限制单次原文替换为非空普通文本，换行操作需使用专用段落能力。
 * @param value - 查找或替换的实际文字。
 * @throws 为空、超过一万字或包含换行时拒绝操作。
 */
function plainText(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 10000 ||
    /[\r\n]/u.test(value)
  )
    throw new Error('原文和新文须为 1 至 10000 字的单段文本。');
}

/**
 * 将文件身份与所选区域绑定到稳定内容，排除每次请求都会变化的追踪信息。
 * @param target - 官方文件身份。
 * @param input - 用户选择的表格区域。
 * @param data - 正文、版本或实际单元格。
 * @returns 独立的内容快照摘要，不携带认证信息。
 */
function fingerprint(target: Target, input: Input, data: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        target.id,
        target.kind,
        input.sheetId,
        input.startRow,
        input.endRow,
        input.startCol,
        input.endCol,
        data,
      ]),
    )
    .digest('hex');
}
