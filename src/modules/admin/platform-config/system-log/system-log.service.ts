import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import {
  getAppName,
  getLokiEnvironment,
  transformKtDateTimeFields,
  throwVbenError,
  ToolsService,
} from '@/common';
import { SystemLogDto } from './system-log.dto';
import type {
  SystemLogQueryDto,
  SystemLogStatusDto,
  SystemLogSummaryDto,
} from './system-log.dto';

type LokiStreamResult = {
  stream?: Record<string, string>;
  values?: Array<[string, string, Record<string, string>?]>;
};

type LokiQueryRangeResponse = {
  data?: {
    result?: LokiStreamResult[];
    resultType?: string;
  };
  status?: string;
};

type LokiMetricResult = {
  metric?: Record<string, string>;
  value?: [number | string, string];
};

type LokiQueryResponse = {
  data?: {
    result?: LokiMetricResult[];
    resultType?: string;
  };
  status?: string;
};

const DEFAULT_LEVELS = ['debug', 'info', 'warning', 'error', 'critical'];
const PINO_LEVEL_MAP: Record<string, string> = {
  '10': 'debug',
  '20': 'debug',
  '30': 'info',
  '40': 'warning',
  '50': 'error',
  '60': 'critical',
};

@Injectable()
export class SystemLogService {
  private readonly appName: string;
  private readonly environment: string;
  private readonly host: string;

  /**
   * 初始化 SystemLogService 实例。
   * @param configService - Nest ConfigService 依赖；驱动 `getAppName()`、`getLokiEnvironment()` 的 Admin步骤。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {
    this.appName = getAppName(configService);
    this.environment = getLokiEnvironment(configService);
    this.host = this.normalizeUrl(
      this.getConfig('LOKI_QUERY_HOST') ||
        this.getConfig('LOKI_HOST') ||
        this.getConfig('LOKI_URL'),
    );
  }

  /**
   * 执行 Admin 平台配置流程。
   * @returns Admin 平台配置产出的 SystemLogStatusDto。
   */
  status(): SystemLogStatusDto {
    return {
      app: this.appName,
      configured: !!this.host,
      env: this.environment,
      host: this.maskHost(this.host),
      selector: this.getBaseSelector(),
    };
  }

  /**
   * 执行 Admin 平台配置流程。
   */
  levels() {
    return DEFAULT_LEVELS.map((level) => ({
      label: level,
      value: level,
    }));
  }

  /**
   * 获取分页数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  async page(query: SystemLogQueryDto = {}) {
    if (!this.host) {
      return {
        items: [],
        total: 0,
      };
    }

    const { pageNo, pageSize } = this.toolsService.getPageParams(query, 1, 20);
    const skip = (pageNo - 1) * pageSize;
    const requestLimit = Math.min(
      this.toolsService.toPositiveNumber(query.limit, skip + pageSize),
      this.getNumberConfig('LOKI_QUERY_MAX_LIMIT', 1000),
    );
    const [logs, total] = await Promise.all([
      this.queryLogs(query, Math.max(requestLimit, pageSize)),
      this.queryLogCount(query),
    ]);
    const filteredLogs = logs.filter((item) => this.matchesQuery(item, query));

    return {
      items: filteredLogs.slice(skip, skip + pageSize),
      total,
    };
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   * @returns 异步完成后的 Admin 平台配置结果。
   */
  async summary(query: SystemLogQueryDto = {}): Promise<SystemLogSummaryDto[]> {
    if (!this.host) {
      return DEFAULT_LEVELS.map((level) => ({ count: 0, level }));
    }

    const countMap = new Map(DEFAULT_LEVELS.map((level) => [level, 0]));
    const counts = await this.queryLogSummary(query);
    counts.forEach(({ count, level }) => {
      countMap.set(level, count);
    });

    return DEFAULT_LEVELS.map((level) => ({
      count: countMap.get(level) || 0,
      level,
    }));
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   * @param limit - limit 输入；驱动 `searchParams.set()` 的 Admin步骤。
   */
  private async queryLogs(query: SystemLogQueryDto, limit: number) {
    const url = new URL(
      this.getConfig('LOKI_QUERY_ENDPOINT', '/loki/api/v1/query_range'),
      this.host,
    );
    const { start, end } = this.getTimeRange(query);
    url.searchParams.set('query', this.buildLogQL(query));
    url.searchParams.set('start', this.toNanoseconds(start));
    url.searchParams.set('end', this.toNanoseconds(end));
    url.searchParams.set('limit', `${limit}`);
    url.searchParams.set('direction', 'backward');

    let response: LokiQueryRangeResponse;
    try {
      response = await this.requestJson<LokiQueryRangeResponse>(url);
    } catch (error) {
      throwVbenError(
        this.toolsService.getErrorMessage(error, 'Loki 查询失败'),
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (response.status && response.status !== 'success') {
      throwVbenError('Loki 查询失败', HttpStatus.BAD_GATEWAY, response.status);
    }

    return this.flattenLogs(response.data?.result || []);
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private async queryLogCount(query: SystemLogQueryDto) {
    const response = await this.queryInstant(
      this.buildCountLogQL(query),
      query,
    );
    const value = response.data?.result?.[0]?.value?.[1];
    return this.toOptionalNumber(value) || 0;
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private async queryLogSummary(query: SystemLogQueryDto) {
    const response = await this.queryInstant(
      this.buildSummaryLogQL(query),
      query,
    );

    return (response.data?.result || [])
      .map((item) => ({
        count: this.toOptionalNumber(item.value?.[1]) || 0,
        level: this.normalizeLevel(item.metric?.level) || 'info',
      }))
      .filter((item) => DEFAULT_LEVELS.includes(item.level));
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param logql - logql 输入；驱动 `searchParams.set()` 的 Admin步骤。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private async queryInstant(logql: string, query: SystemLogQueryDto) {
    const url = new URL(this.getInstantQueryEndpoint(), this.host);
    const { end } = this.getTimeRange(query);
    url.searchParams.set('query', logql);
    url.searchParams.set('time', `${Math.floor(end.getTime() / 1000)}`);

    let response: LokiQueryResponse;
    try {
      response = await this.requestJson<LokiQueryResponse>(url);
    } catch (error) {
      throwVbenError(
        this.toolsService.getErrorMessage(error, 'Loki 查询失败'),
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (response.status && response.status !== 'success') {
      throwVbenError('Loki 查询失败', HttpStatus.BAD_GATEWAY, response.status);
    }

    return response;
  }

  /**
   * 创建 Admin 平台配置对象或配置。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private buildLogQL(query: SystemLogQueryDto) {
    const selector = this.withLevelSelector(
      this.getBaseSelector(),
      this.normalizeLevel(query.level),
    );
    const lineFilters = [
      query.keyword,
      query.context,
      query.path,
      query.requestId,
    ]
      .map((value) => this.toolsService.toTrimmedString(value))
      .filter(Boolean)
      .map((value) => `|= "${this.escapeLogqlString(value)}"`);

    return [selector, ...lineFilters].join(' ');
  }

  /**
   * 创建 Admin 平台配置对象或配置。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private buildCountLogQL(query: SystemLogQueryDto) {
    return `sum(count_over_time(${this.buildLogQL(query)}[${this.getLogqlRange(query)}]))`;
  }

  /**
   * 创建 Admin 平台配置对象或配置。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private buildSummaryLogQL(query: SystemLogQueryDto) {
    return `sum by (level)(count_over_time(${this.buildLogQL(query)}[${this.getLogqlRange(query)}]))`;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param selector - selector 输入；计算 Admin布尔判断。
   * @param level - level 输入；驱动 `this.escapeLabelValue()` 的 Admin步骤。
   */
  private withLevelSelector(selector: string, level?: string) {
    if (!level || selector.includes('level=')) return selector;
    return selector.replace(
      /}\s*$/,
      `,level="${this.escapeLabelValue(level)}"}`,
    );
  }

  /**
   * 查询 Admin 平台配置数据。
   */
  private getBaseSelector() {
    const selector = this.getConfig('LOKI_QUERY_SELECTOR');
    if (selector) return selector;

    return `{app="${this.escapeLabelValue(
      this.appName,
    )}",env="${this.escapeLabelValue(this.environment)}"}`;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param streams - Admin列表；影响 flattenLogs 的返回值。
   * @returns Admin 平台配置产出的 SystemLogDto[]。
   */
  private flattenLogs(streams: LokiStreamResult[]): SystemLogDto[] {
    return streams
      .flatMap((stream, streamIndex) =>
        (stream.values || []).map(([timestampNs, line, metadata], rowIndex) =>
          this.serializeLog({
            line,
            metadata,
            rowIndex,
            stream: stream.stream || {},
            streamIndex,
            timestampNs,
          }),
        ),
      )
      .sort((prev, next) =>
        this.compareTimestamp(next.timestampNs, prev.timestampNs),
      );
  }

  /**
   * 序列化Log。
   * @param params - Admin列表；使用 `line`、`stream`、`metadata`、`timestampNs` 字段生成结果。
   * @returns Admin 平台配置产出的 SystemLogDto。
   */
  private serializeLog(params: {
    line: string;
    metadata?: Record<string, string>;
    rowIndex: number;
    stream: Record<string, string>;
    streamIndex: number;
    timestampNs: string;
  }): SystemLogDto {
    const parsed = this.parseLogLine(params.line);
    const req = this.asRecord(parsed.req);
    const res = this.asRecord(parsed.res);
    const meta = this.asRecord(parsed.meta);
    const level =
      this.normalizeLevel(params.stream.level) ||
      this.normalizeLevel(parsed.level) ||
      'info';
    const requestId =
      this.pickText(
        params.metadata?.requestId,
        parsed.requestId,
        meta.requestId,
        req.id,
      ) || undefined;
    const path =
      this.toolsService.normalizeRequestPathValue(
        this.pickText(
          parsed.path,
          parsed.url,
          parsed.originalUrl,
          req.path,
          req.url,
          req.originalUrl,
        ),
      ) || undefined;
    const method =
      this.pickText(parsed.method, req.method)?.toUpperCase() || undefined;

    return transformKtDateTimeFields(
      Object.assign(new SystemLogDto(), {
        context:
          this.pickText(parsed.context, params.stream.context) || undefined,
        durationMs: this.toOptionalNumber(
          parsed.durationMs,
          parsed.responseTime,
        ),
        hostname: params.stream.hostname,
        id: `${params.timestampNs}-${params.streamIndex}-${params.rowIndex}`,
        level,
        message:
          this.pickText(parsed.msg, parsed.message, parsed.err?.message) ||
          params.line,
        method,
        path,
        raw: params.line,
        requestId,
        statusCode: this.toOptionalNumber(parsed.statusCode, res.statusCode),
        timestamp: this.timestampNsToDate(params.timestampNs),
        timestampNs: params.timestampNs,
      }),
    );
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param item - item 输入；使用 `level`、`raw`、`message`、`context` 字段生成结果。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private matchesQuery(item: SystemLogDto, query: SystemLogQueryDto) {
    const level = this.normalizeLevel(query.level);
    if (level && item.level !== level) return false;
    if (
      !this.includes(item.raw, query.keyword) &&
      !this.includes(item.message, query.keyword)
    ) {
      return false;
    }
    if (!this.includes(item.context, query.context)) return false;
    if (!this.includes(item.path, query.path)) return false;
    if (!this.includes(item.requestId, query.requestId)) return false;
    return true;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换值；驱动 `toolsService.includesText()` 的 Admin步骤。
   * @param keyword - keyword 输入；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
   */
  private includes(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toolsService.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;
    return this.toolsService.includesText(value, normalizedKeyword);
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private getTimeRange(query: SystemLogQueryDto) {
    const end = this.toDate(query.endTime) || new Date();
    const start =
      this.toDate(query.startTime) ||
      new Date(
        end.getTime() -
          this.toolsService.toPositiveNumber(query.rangeMinutes, 60) *
            60 *
            1000,
      );
    return { end, start };
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  private getLogqlRange(query: SystemLogQueryDto) {
    const { end, start } = this.getTimeRange(query);
    const seconds = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / 1000),
    );

    return `${seconds}s`;
  }

  /**
   * 查询 Admin 平台配置数据。
   */
  private getInstantQueryEndpoint() {
    const endpoint = this.getConfig('LOKI_QUERY_INSTANT_ENDPOINT');
    if (endpoint) return endpoint;

    return this.getConfig(
      'LOKI_QUERY_ENDPOINT',
      '/loki/api/v1/query_range',
    ).replace(/query_range$/, 'query');
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param url - 访问地址；使用 `protocol` 字段生成结果。
   */
  private requestJson<T>(url: URL) {
    return new Promise<T>((resolve, reject) => {
      const client = url.protocol === 'http:' ? http : https;
      const request = client.request(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'kt-template-online-api/admin-system-log',
            ...this.getHeaders(),
          },
          method: 'GET',
          timeout: this.getNumberConfig('LOKI_QUERY_TIMEOUT_MS', 10000),
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            if ((response.statusCode || 500) >= 400) {
              reject(new Error(`Loki 查询失败：${response.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error('Loki 返回不是合法 JSON'));
            }
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Loki 查询超时'));
      });
      request.on('error', reject);
      request.end();
    });
  }

  /**
   * 查询 Admin 平台配置数据。
   */
  private getHeaders() {
    const headers: Record<string, string> = {};
    const tenantId = this.getConfig('LOKI_TENANT_ID');
    const username = this.getConfig('LOKI_USERNAME');
    const password = this.getConfig('LOKI_PASSWORD');

    if (tenantId) headers['X-Scope-OrgID'] = tenantId;
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(
        `${username}:${password}`,
      ).toString('base64')}`;
    }

    return headers;
  }

  /**
   * 解析Log Line。
   * @param line - line 输入；转换 JSON 文本。
   * @returns Admin 平台配置渲染后的图片、画布或文本。
   */
  private parseLogLine(line: string): Record<string, any> {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换值；影响 asRecord 的返回值。
   * @returns Admin 平台配置渲染后的图片、画布或文本。
   */
  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object'
      ? (value as Record<string, any>)
      : {};
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param values - 配置值字典；驱动 `toolsService.pickFirstText()` 的 Admin步骤。
   */
  private pickText(...values: unknown[]) {
    return this.toolsService.pickFirstText(...values);
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param value - 待转换值；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
   */
  private normalizeLevel(value: unknown) {
    const text = this.toolsService.toTrimmedString(value).toLowerCase();
    if (!text) return '';
    if (PINO_LEVEL_MAP[text]) return PINO_LEVEL_MAP[text];
    if (text === 'warn') return 'warning';
    return DEFAULT_LEVELS.includes(text) ? text : '';
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换时间值；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
   */
  private toDate(value: unknown) {
    const text = this.toolsService.toTrimmedString(value);
    if (!text) return null;
    const timestamp = /^\d+$/.test(text)
      ? this.normalizeTimestamp(text)
      : Date.parse(text);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param date - date 输入；执行 `date.getTime()` 对应的 Admin步骤。
   */
  private toNanoseconds(date: Date) {
    return `${BigInt(date.getTime()) * 1000000n}`;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换时间值；构造时间对象。
   */
  private timestampNsToDate(value: string) {
    try {
      return new Date(Number(BigInt(value) / 1000000n));
    } catch {
      return new Date();
    }
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param left - left 输入；执行 `left.localeCompare()` 对应的 Admin步骤。
   * @param right - right 输入；驱动 `BigInt()`、`left.localeCompare()` 的 Admin步骤。
   */
  private compareTimestamp(left: string, right: string) {
    try {
      const diff = BigInt(left) - BigInt(right);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return left.localeCompare(right);
    }
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param values - 配置值字典；驱动 `for()` 的 Admin步骤。
   */
  private toOptionalNumber(...values: unknown[]) {
    for (const value of values) {
      const nextValue = Number(value);
      if (Number.isFinite(nextValue)) return nextValue;
    }
    return undefined;
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换值；生成规范化文本。
   */
  private escapeLogqlString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param value - 待转换值；驱动 `this.escapeLogqlString()` 的 Admin步骤。
   */
  private escapeLabelValue(value: string) {
    return this.escapeLogqlString(value);
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param key - 键名；限定 Admin查询范围。
   * @param fallback - 兜底值；驱动 `toolsService.toTrimmedString()` 的 Admin步骤。
   */
  private getConfig(key: string, fallback = '') {
    const value = this.configService.get<string>(key);
    return this.toolsService.toTrimmedString(value || fallback);
  }

  /**
   * 查询 Admin 平台配置数据。
   * @param key - 键名；驱动 `Number()` 的 Admin步骤。
   * @param fallback - 兜底值；驱动 `Number.isFinite()` 的 Admin步骤。
   */
  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param value - 待转换值；生成规范化文本。
   */
  private normalizeUrl(value: string) {
    return value.replace(/\/+$/g, '');
  }

  /**
   * 执行 Admin 平台配置流程。
   * @param host - host 输入；驱动 `URL()` 的 Admin步骤。
   */
  private maskHost(host: string) {
    if (!host) return undefined;
    try {
      const url = new URL(host);
      if (url.username || url.password) {
        url.username = '***';
        url.password = '***';
      }
      return url.toString().replace(/\/+$/g, '');
    } catch {
      return host;
    }
  }

  /**
   * 转换 Admin 平台配置输入。
   * @param value - 待转换时间值；使用 `length` 字段生成结果。
   */
  private normalizeTimestamp(value: string) {
    if (value.length === 10) return Number(value) * 1000;
    if (value.length === 16) return Math.floor(Number(value) / 1000);
    if (value.length >= 19) return Number(BigInt(value) / 1000000n);
    return Number(value);
  }
}
