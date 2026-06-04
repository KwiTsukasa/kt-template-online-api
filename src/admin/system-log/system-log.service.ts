import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import {
  getAppName,
  getLokiEnvironment,
  formatDateTimeFields,
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

  status(): SystemLogStatusDto {
    return {
      app: this.appName,
      configured: !!this.host,
      env: this.environment,
      host: this.maskHost(this.host),
      selector: this.getBaseSelector(),
    };
  }

  levels() {
    return DEFAULT_LEVELS.map((level) => ({
      label: level,
      value: level,
    }));
  }

  async page(query: SystemLogQueryDto = {}) {
    if (!this.host) {
      return {
        items: [],
        total: 0,
      };
    }

    const { pageNo, pageSize } = this.toolsService.getPageParams(
      query,
      1,
      20,
    );
    const requestLimit = Math.min(
      this.toolsService.toPositiveNumber(query.limit, pageNo * pageSize),
      this.getNumberConfig('LOKI_QUERY_MAX_LIMIT', 1000),
    );
    const logs = await this.queryLogs(query, Math.max(requestLimit, pageSize));
    const filteredLogs = logs.filter((item) => this.matchesQuery(item, query));
    const startIndex = (pageNo - 1) * pageSize;

    return {
      items: filteredLogs.slice(startIndex, startIndex + pageSize),
      total: filteredLogs.length,
    };
  }

  async summary(
    query: SystemLogQueryDto = {},
  ): Promise<SystemLogSummaryDto[]> {
    if (!this.host) {
      return DEFAULT_LEVELS.map((level) => ({ count: 0, level }));
    }

    const logs = await this.queryLogs(
      {
        ...query,
        level: undefined,
      },
      this.toolsService.toPositiveNumber(query.limit, 1000),
    );
    const filteredLogs = logs.filter((item) => this.matchesQuery(item, query));
    const countMap = new Map(DEFAULT_LEVELS.map((level) => [level, 0]));
    filteredLogs.forEach((item) => {
      const level = this.normalizeLevel(item.level) || 'info';
      countMap.set(level, (countMap.get(level) || 0) + 1);
    });

    return DEFAULT_LEVELS.map((level) => ({
      count: countMap.get(level) || 0,
      level,
    }));
  }

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

  private withLevelSelector(selector: string, level?: string) {
    if (!level || selector.includes('level=')) return selector;
    return selector.replace(/}\s*$/, `,level="${this.escapeLabelValue(level)}"}`);
  }

  private getBaseSelector() {
    const selector = this.getConfig('LOKI_QUERY_SELECTOR');
    if (selector) return selector;

    return `{app="${this.escapeLabelValue(
      this.appName,
    )}",env="${this.escapeLabelValue(this.environment)}"}`;
  }

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
      this.pickText(params.metadata?.requestId, meta.requestId, req.id) ||
      undefined;
    const path = this.pickText(parsed.path, req.url, req.originalUrl) || undefined;

    return formatDateTimeFields(
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
        method: this.pickText(parsed.method, req.method) || undefined,
        path,
        raw: params.line,
        requestId,
        statusCode: this.toOptionalNumber(parsed.statusCode, res.statusCode),
        timestamp: this.timestampNsToDate(params.timestampNs),
        timestampNs: params.timestampNs,
      }),
    );
  }

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

  private includes(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toolsService.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;
    return this.toolsService.includesText(value, normalizedKeyword);
  }

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

  private parseLogLine(line: string): Record<string, any> {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? (value as Record<string, any>) : {};
  }

  private pickText(...values: unknown[]) {
    return this.toolsService.pickFirstText(...values);
  }

  private normalizeLevel(value: unknown) {
    const text = this.toolsService.toTrimmedString(value).toLowerCase();
    if (!text) return '';
    if (PINO_LEVEL_MAP[text]) return PINO_LEVEL_MAP[text];
    if (text === 'warn') return 'warning';
    return DEFAULT_LEVELS.includes(text) ? text : '';
  }

  private toDate(value: unknown) {
    const text = this.toolsService.toTrimmedString(value);
    if (!text) return null;
    const timestamp = /^\d+$/.test(text) ? this.normalizeTimestamp(text) : Date.parse(text);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toNanoseconds(date: Date) {
    return `${BigInt(date.getTime()) * 1000000n}`;
  }

  private timestampNsToDate(value: string) {
    try {
      return new Date(Number(BigInt(value) / 1000000n));
    } catch {
      return new Date();
    }
  }

  private compareTimestamp(left: string, right: string) {
    try {
      const diff = BigInt(left) - BigInt(right);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    } catch {
      return left.localeCompare(right);
    }
  }

  private toOptionalNumber(...values: unknown[]) {
    for (const value of values) {
      const nextValue = Number(value);
      if (Number.isFinite(nextValue)) return nextValue;
    }
    return undefined;
  }

  private escapeLogqlString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private escapeLabelValue(value: string) {
    return this.escapeLogqlString(value);
  }

  private getConfig(key: string, fallback = '') {
    const value = this.configService.get<string>(key);
    return this.toolsService.toTrimmedString(value || fallback);
  }

  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private normalizeUrl(value: string) {
    return value.replace(/\/+$/g, '');
  }

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

  private normalizeTimestamp(value: string) {
    if (value.length === 10) return Number(value) * 1000;
    if (value.length === 16) return Math.floor(Number(value) / 1000);
    if (value.length >= 19) return Number(BigInt(value) / 1000000n);
    return Number(value);
  }
}
