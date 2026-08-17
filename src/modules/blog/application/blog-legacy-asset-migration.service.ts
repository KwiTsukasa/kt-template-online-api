import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { basename, dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import type { LookupAddress } from 'node:dns';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MinioClientService } from '@/modules/asset/application/asset-minio.service';
import type {
  BlogLegacyAssetFetchedObject,
  BlogLegacyAssetMigrationEntry,
  BlogLegacyAssetMigrationField,
  BlogLegacyAssetMigrationManifest,
  BlogLegacyAssetMigrationManifestStore,
  BlogLegacyAssetMigrationOptions,
  BlogLegacyAssetMigrationTable,
} from '../domain/blog-legacy-asset-migration.types';
import { BlogArticle } from '../infrastructure/persistence/blog-article.entity';
import { BlogThemeConfig } from '../infrastructure/persistence/blog-theme-config.entity';

export const BLOG_LEGACY_ASSET_DNS_RESOLVER = Symbol(
  'BLOG_LEGACY_ASSET_DNS_RESOLVER',
);
export const BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST = Symbol(
  'BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST',
);
export const BLOG_LEGACY_ASSET_MANIFEST_STORE = Symbol(
  'BLOG_LEGACY_ASSET_MANIFEST_STORE',
);

export type BlogLegacyAssetDnsResolver = (
  hostname: string,
) => Promise<LookupAddress[]>;

export type BlogLegacyAssetRawHttpResponse = {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  status: number;
};

export type BlogLegacyAssetRawHttpRequest = (options: {
  address: string;
  family: 4 | 6;
  maxBytes: number;
  timeoutMs: number;
  url: URL;
}) => Promise<BlogLegacyAssetRawHttpResponse>;

type ArticleField = 'contentHtml' | 'contentMarkdown' | 'cover' | 'excerpt';

type SourceField = {
  field: BlogLegacyAssetMigrationField;
  rowId: string;
  table: BlogLegacyAssetMigrationTable;
  value: unknown;
};

const ARTICLE_FIELD_MAP: ReadonlyArray<{
  entityField: ArticleField;
  manifestField: Exclude<BlogLegacyAssetMigrationField, 'config'>;
}> = [
  {
    entityField: 'contentHtml',
    manifestField: 'content_html',
  },
  {
    entityField: 'contentMarkdown',
    manifestField: 'content_markdown',
  },
  {
    entityField: 'cover',
    manifestField: 'cover',
  },
  {
    entityField: 'excerpt',
    manifestField: 'excerpt',
  },
];
const SAFE_MIME_TYPES = new Set([
  'application/vnd.ms-fontobject',
  'audio/mpeg',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/x-icon',
  'video/mp4',
  'video/webm',
]);
const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/giu;
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MANIFEST_MODES = new Set<unknown>([
  'dry-run',
  'execute',
  'resume',
  'rollback',
  'verify',
]);
const MANIFEST_STATUSES = new Set<unknown>([
  'completed',
  'failed',
  'planned',
  'rolled-back',
  'verified',
]);
const MANIFEST_ENTRY_STATUSES = new Set<unknown>([
  'completed',
  'failed',
  'planned',
  'rolled-back',
  'verified',
]);
const ARTICLE_MANIFEST_FIELDS = new Set<unknown>([
  'content_html',
  'content_markdown',
  'cover',
  'excerpt',
]);

export class BlogLegacyAssetMigrationUsageError extends Error {}

@Injectable()
export class BlogLegacyAssetManifestFileStore implements BlogLegacyAssetMigrationManifestStore {
  /**
   * 校验`path`是否满足路径约束，并拒绝不合法输入。
   * @param path - 必须保持在受控根目录内的路径。
   * @throws 当 `!target.includes(workspaceSegment) || !target.endsWith('.json') || base…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  assertPath(path: string): void {
    const target = resolve(path);
    const workspaceSegment = `${sep}.kt-workspace${sep}`;
    if (
      !target.includes(workspaceSegment) ||
      !target.endsWith('.json') ||
      basename(target) === '.kt-workspace'
    ) {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest 必须由调用方指定为 .kt-workspace 下的 JSON 文件',
      );
    }
  }

  /**
   * 根据`path`处理在路径安全校验后检查存在；先通过 `assertPath` 校验输入边界。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 在路径安全校验后检查存在。
   */
  exists(path: string): boolean {
    this.assertPath(path);
    return existsSync(resolve(path));
  }

  /**
   * 按`path`读取博客旧版资源清单文件记录；先通过 `assertPath` 校验输入边界。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 博客旧版资源清单文件记录。
   * @throws 当 `JSON.parse` 或 `readFile` 调用失败时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  async read(path: string): Promise<BlogLegacyAssetMigrationManifest> {
    this.assertPath(path);
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(resolve(path), 'utf8'));
    } catch {
      throw new BlogLegacyAssetMigrationUsageError('manifest JSON 无效');
    }
    assertBlogLegacyAssetMigrationManifest(manifest);
    return manifest;
  }

  /**
   * 根据`path`、`manifest`更新博客旧版资源清单文件记录；把变更持久化到当前存储（`writeFile`）。
   * @param path - 必须保持在受控根目录内的路径。
   * @param manifest - 决定博客旧版资源清单文件记录内容、边界或目标的 `manifest` 值。
   * @throws 当 `writeFile` 或 `JSON.stringify` 调用失败时重新抛出该入口捕获且决定公开的原异常；当 `writeError === undefined` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  async write(
    path: string,
    manifest: BlogLegacyAssetMigrationManifest,
  ): Promise<void> {
    this.assertPath(path);
    assertBlogLegacyAssetMigrationManifest(manifest);
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    const temporaryPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    let writeError: unknown;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, target);
    } catch (error) {
      writeError = error;
      throw error;
    } finally {
      try {
        await rm(temporaryPath, { force: true });
      } catch (error) {
        if (writeError === undefined) throw error;
      }
    }
  }
}

@Injectable()
export class BlogLegacyAssetHttpFetcher {
  constructor(
    private readonly configService: ConfigService,
    @Inject(BLOG_LEGACY_ASSET_DNS_RESOLVER)
    private readonly resolveDns: BlogLegacyAssetDnsResolver,
    @Inject(BLOG_LEGACY_ASSET_RAW_HTTP_REQUEST)
    private readonly request: BlogLegacyAssetRawHttpRequest,
  ) {}

  /**
   * 根据`value`与当前约束判定允许的来源URL。
   * @param value - 待判定是否满足允许的来源URL约束的候选值。
   * @returns 满足允许的来源URL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isAllowedSourceUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return this.isAllowedUrl(url);
    } catch {
      return false;
    }
  }

  /**
   * 按`value`读取博客旧版资源HTTP获取器记录；从受控资源来源加载所需数据（`request`）。
   * @param value - 参与博客旧版资源HTTP获取器记录比较、格式化或输出的候选值。
   * @returns 包含 `buffer`、`finalUrl`、`mimeType` 字段的博客旧版资源HTTP获取器记录。
   * @throws 当 `dnsBudget <= 0` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `requestBudget <= 0` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `redirects >= maxRedirects` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `!location` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `response.status < 200 || response.status >= 300` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `(!Number.isFinite(contentLength) && contentLength !== 0) || contentLeng…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `!SAFE_MIME_TYPES.has(mimeType)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  async fetch(value: string): Promise<BlogLegacyAssetFetchedObject> {
    const maxRedirects = this.readPositiveInteger(
      'BLOG_ASSET_MIGRATION_MAX_REDIRECTS',
      3,
      0,
      10,
    );
    const maxBytes = this.readPositiveInteger(
      'BLOG_ASSET_MIGRATION_MAX_BYTES',
      10 * 1024 * 1024,
      1,
      100 * 1024 * 1024,
    );
    const timeoutMs = this.readPositiveInteger(
      'BLOG_ASSET_MIGRATION_TIMEOUT_MS',
      10_000,
      100,
      60_000,
    );
    let url = this.parseAllowedUrl(value);
    let redirects = 0;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const dnsBudget = deadline - Date.now();
      if (dnsBudget <= 0) {
        throw new BlogLegacyAssetMigrationUsageError('资源下载超时');
      }
      const selectedAddress = await withTimeout(
        this.resolveAndValidateAddress(url),
        dnsBudget,
      );
      const requestBudget = deadline - Date.now();
      if (requestBudget <= 0) {
        throw new BlogLegacyAssetMigrationUsageError('资源下载超时');
      }
      const response = await this.request({
        address: selectedAddress.address,
        family: selectedAddress.family,
        maxBytes,
        timeoutMs: requestBudget,
        url,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= maxRedirects) {
          throw new BlogLegacyAssetMigrationUsageError('资源重定向次数超限');
        }
        const location = readHeader(response.headers, 'location');
        if (!location) {
          throw new BlogLegacyAssetMigrationUsageError('资源重定向缺少地址');
        }
        url = this.parseAllowedUrl(new URL(location, url).toString());
        redirects += 1;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new BlogLegacyAssetMigrationUsageError(
          `资源下载失败：HTTP ${response.status}`,
        );
      }
      const contentLength = Number(
        readHeader(response.headers, 'content-length') || 0,
      );
      if (
        (!Number.isFinite(contentLength) && contentLength !== 0) ||
        contentLength > maxBytes ||
        response.body.length > maxBytes
      ) {
        throw new BlogLegacyAssetMigrationUsageError('资源大小超过限制');
      }
      const mimeType = `${readHeader(response.headers, 'content-type') || ''}`
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!SAFE_MIME_TYPES.has(mimeType)) {
        throw new BlogLegacyAssetMigrationUsageError('资源 MIME 类型不允许');
      }

      return {
        buffer: response.body,
        finalUrl: url.toString(),
        mimeType,
      };
    }
  }

  /**
   * 解析旧资源 URL 并校验精确协议、主机与端口白名单；格式或范围不合法时拒绝迁移。
   * @param value - 待转换为允许的URL的原始值。
   * @returns 允许的URL。
   * @throws 输入无法构造为 URL 时抛出格式错误；URL 不满足精确协议、主机与端口白名单时抛出范围错误。
   */
  private parseAllowedUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BlogLegacyAssetMigrationUsageError('资源 URL 无效');
    }
    if (!this.isAllowedUrl(url)) {
      throw new BlogLegacyAssetMigrationUsageError(
        '资源 URL 不在精确 allowlist 中',
      );
    }
    return url;
  }

  /**
   * 根据`url`与当前约束判定允许的URL；从 `readAllowedHosts` 读取允许的URL。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 满足允许的URL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isAllowedUrl(url: URL): boolean {
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password || url.hash) return false;
    const allowedHosts = this.readAllowedHosts();
    return allowedHosts.has(url.host.toLowerCase());
  }

  /**
   * 按当前运行态读取允许的主机；从 `configService.get` 读取允许的主机。
   * @returns 去重后的允许的主机集合；没有输入项时为空集合。
   * @throws 当 `!values.length` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  private readAllowedHosts(): ReadonlySet<string> {
    const raw = `${
      this.configService.get('BLOG_ASSET_MIGRATION_ALLOWED_HOSTS') || ''
    }`;
    const values = raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!values.length) {
      throw new BlogLegacyAssetMigrationUsageError(
        'BLOG_ASSET_MIGRATION_ALLOWED_HOSTS 不能为空',
      );
    }
    const normalized = values.map((value) => {
      if (value.includes('://') || value.includes('/')) {
        throw new BlogLegacyAssetMigrationUsageError(
          'BLOG_ASSET_MIGRATION_ALLOWED_HOSTS 只能包含精确 host',
        );
      }
      if (value.includes('?') || value.includes('#')) {
        throw new BlogLegacyAssetMigrationUsageError(
          'BLOG_ASSET_MIGRATION_ALLOWED_HOSTS 只能包含精确 host',
        );
      }
      if (value.includes('@') || value.includes('*')) {
        throw new BlogLegacyAssetMigrationUsageError(
          'BLOG_ASSET_MIGRATION_ALLOWED_HOSTS 只能包含精确 host',
        );
      }
      try {
        const parsed = new URL(`https://${value}`);
        if (parsed.pathname !== '/' || !parsed.hostname) throw new Error();
        return parsed.host.toLowerCase();
      } catch {
        throw new BlogLegacyAssetMigrationUsageError(
          'BLOG_ASSET_MIGRATION_ALLOWED_HOSTS 包含无效 host',
        );
      }
    });
    return new Set(normalized);
  }

  /**
   * 从`url`解析与校验地址。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 与校验地址。
   * @throws 当 `!addresses.length` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `normalized.some( (entry) => (entry.family !== 4 && entry.family !== 6)…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  private async resolveAndValidateAddress(
    url: URL,
  ): Promise<{ address: string; family: 4 | 6 }> {
    const hostname = url.hostname.replace(/^\[(.*)\]$/u, '$1');
    const addresses = await this.resolveDns(hostname);
    if (!addresses.length) {
      throw new BlogLegacyAssetMigrationUsageError('资源 Host 无 DNS 结果');
    }
    const normalized = addresses.map((entry) => ({
      address: entry.address,
      family: entry.family,
    }));
    if (
      normalized.some(
        (entry) =>
          (entry.family !== 4 && entry.family !== 6) ||
          isForbiddenAddress(entry.address),
      )
    ) {
      throw new BlogLegacyAssetMigrationUsageError(
        '资源 Host 解析到禁止的不安全地址',
      );
    }
    return normalized[0] as { address: string; family: 4 | 6 };
  }

  /**
   * 按`key`、`fallback`、`min`读取正数整数；当 `raw === undefined || raw === null || `${raw}`.trim() === ''` 成立时返回 `fallback`。
   * @param key - 用于读取或更新正数整数的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @param min - 决定正数整数内容、边界或目标的 `min` 值。
   * @param max - 决定正数整数内容、边界或目标的 `max` 值。
   * @returns 正数整数。
   * @throws 当 `!Number.isInteger(value) || value < min || value > max` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  private readPositiveInteger(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.configService.get<string | number>(key);
    if (raw === undefined || raw === null || `${raw}`.trim() === '') {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${key} 必须是 ${min} 到 ${max} 之间的整数`,
      );
    }
    return value;
  }
}

@Injectable()
export class BlogLegacyAssetMigrationService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(BlogArticle)
    private readonly articleRepository: Repository<BlogArticle>,
    @InjectRepository(BlogThemeConfig)
    private readonly themeRepository: Repository<BlogThemeConfig>,
    private readonly dataSource: DataSource,
    private readonly minioClientService: MinioClientService,
    private readonly fetcher: BlogLegacyAssetHttpFetcher,
    @Inject(BLOG_LEGACY_ASSET_MANIFEST_STORE)
    private readonly manifestStore: BlogLegacyAssetMigrationManifestStore,
  ) {}

  /**
   * 根据`options`处理博客旧版资源迁移记录；先通过 `manifestStore.assertPath` 校验输入边界。
   * @param options - 控制博客旧版资源迁移记录筛选、缓存或输出方式的可选项，包含 `manifestPath`、`mode` 字段。
   * @returns 博客旧版资源迁移记录。
   * @throws 当 `options.mode === 'dry-run' && this.manifestStore.exists(options.manifes…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `existing.status !== 'planned'` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  async run(
    options: BlogLegacyAssetMigrationOptions,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    this.manifestStore.assertPath(options.manifestPath);
    this.assertDestructiveSafety(options);
    if (options.mode === 'verify') return this.verify(options);
    if (options.mode === 'rollback') return this.rollback(options);
    if (options.mode === 'resume') return this.resume(options);

    if (
      options.mode === 'dry-run' &&
      this.manifestStore.exists(options.manifestPath)
    ) {
      throw new BlogLegacyAssetMigrationUsageError(
        'dry-run manifest 已存在，禁止覆盖恢复证据',
      );
    }
    let manifest: BlogLegacyAssetMigrationManifest;
    if (
      options.mode === 'execute' &&
      this.manifestStore.exists(options.manifestPath)
    ) {
      const existing = await this.readManifest(options.manifestPath);
      if (existing.status !== 'planned') {
        throw new BlogLegacyAssetMigrationUsageError(
          'execute 只能使用 planned manifest；失败任务请使用 resume',
        );
      }
      manifest = {
        ...existing,
        mode: 'execute',
        updatedAt: new Date().toISOString(),
      };
    } else {
      manifest = await this.buildManifest(options.mode);
    }
    await this.manifestStore.write(options.manifestPath, manifest);
    if (options.mode === 'dry-run') return manifest;
    return this.execute(options, manifest);
  }

  /**
   * 根据`mode`构造清单；从受控资源来源加载所需数据（`fetcher.fetch`）。
   * @param mode - 选择清单处理分支的模式值。
   * @returns 包含 `createdAt`、`entries`、`mode`、`status`、`updatedAt` 字段的清单。
   */
  private async buildManifest(
    mode: 'dry-run' | 'execute',
  ): Promise<BlogLegacyAssetMigrationManifest> {
    const sourceFields = await this.scanSourceFields();
    const entries: BlogLegacyAssetMigrationEntry[] = [];
    const seen = new Set<string>();

    for (const source of sourceFields) {
      for (const oldUrl of extractUrls(source.value)) {
        if (!this.fetcher.isAllowedSourceUrl(oldUrl)) continue;
        const identity = [
          source.table,
          source.rowId,
          source.field,
          oldUrl,
        ].join('\u0000');
        if (seen.has(identity)) continue;
        seen.add(identity);

        const fetched = await this.fetcher.fetch(oldUrl);
        const contentSha256 = createHash('sha256')
          .update(fetched.buffer)
          .digest('hex');
        const safeBasename = createSafeBasename(fetched.finalUrl);
        entries.push({
          basename: safeBasename,
          contentSha256,
          field: source.field,
          mimeType: fetched.mimeType,
          objectKey: `blog/migrated/${contentSha256}/${safeBasename}`,
          oldUrl,
          publicUrl: `/api/blog/asset/${contentSha256}/${safeBasename}`,
          rowId: source.rowId,
          size: fetched.buffer.length,
          status: 'planned',
          table: source.table,
        });
      }
    }

    assertManifestEntrySetSafety(entries);
    const now = new Date().toISOString();
    return {
      createdAt: now,
      entries,
      mode,
      status: 'planned',
      updatedAt: now,
      version: 1,
    };
  }

  /**
   * 从输入或当前状态提取扫描来源字段。
   * @returns 按输入顺序得到的扫码会话来源Fields列表；没有匹配项时为空数组。
   */
  private async scanSourceFields(): Promise<SourceField[]> {
    const [articles, themes] = await Promise.all([
      this.articleRepository.find(),
      this.themeRepository.find(),
    ]);
    const fields: SourceField[] = [];
    for (const article of articles) {
      for (const mapping of ARTICLE_FIELD_MAP) {
        fields.push({
          field: mapping.manifestField,
          rowId: String(article.id),
          table: 'blog_article',
          value: article[mapping.entityField],
        });
      }
    }
    for (const theme of themes) {
      fields.push({
        field: 'config',
        rowId: String(theme.id),
        table: 'blog_theme_config',
        value: theme.config,
      });
    }
    return fields;
  }

  /**
   * 从已持久化状态恢复。
   * @param options - 控制从已持久化状态恢复筛选、缓存或输出方式的可选项，包含 `manifestPath` 字段。
   * @returns 从已持久化状态恢复。
   */
  private async resume(
    options: BlogLegacyAssetMigrationOptions,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    const manifest = await this.readManifest(options.manifestPath);
    const pendingEntries = manifest.entries.filter(
      (entry) => entry.status !== 'completed' && entry.status !== 'verified',
    );
    if (!pendingEntries.length) {
      const resumed: BlogLegacyAssetMigrationManifest = {
        ...manifest,
        mode: 'resume',
        updatedAt: new Date().toISOString(),
      };
      await this.manifestStore.write(options.manifestPath, resumed);
      return resumed;
    }
    return this.execute(
      options,
      {
        ...manifest,
        mode: 'resume',
        status: 'planned',
      },
      pendingEntries,
    );
  }

  /**
   * 根据`options`、`manifest`、`targetEntries`处理博客旧版资源迁移记录；从受控资源来源加载所需数据（`fetcher.fetch`）。
   * @param options - 控制博客旧版资源迁移记录筛选、缓存或输出方式的可选项，包含 `manifestPath` 字段。
   * @param manifest - 决定博客旧版资源迁移记录内容、边界或目标的 `manifest` 值。
   * @param targetEntries - 决定博客旧版资源迁移记录内容、边界或目标的 `targetEntries` 值；省略时默认采用 `manifest.entries`。
   * @returns 博客旧版资源迁移记录。
   * @throws 当 `contentSha256 !== entry.contentSha256 || fetched.buffer.length !== entr…` 成立时拒绝当前输入并抛出 `Error`；当 `fetcher.fetch` 或 `digest` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async execute(
    options: BlogLegacyAssetMigrationOptions,
    manifest: BlogLegacyAssetMigrationManifest,
    targetEntries: BlogLegacyAssetMigrationEntry[] = manifest.entries,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    try {
      for (const entry of targetEntries) {
        const fetched = await this.fetcher.fetch(entry.oldUrl);
        const contentSha256 = createHash('sha256')
          .update(fetched.buffer)
          .digest('hex');
        if (
          contentSha256 !== entry.contentSha256 ||
          fetched.buffer.length !== entry.size ||
          fetched.mimeType !== entry.mimeType
        ) {
          throw new Error('旧资源内容与 manifest 不一致');
        }
        await this.minioClientService.uploadObject({
          file: {
            buffer: fetched.buffer,
            mimetype: entry.mimeType,
            originalname: entry.basename,
            size: entry.size,
          },
          objectName: entry.objectKey,
        });
      }

      await this.dataSource.transaction(async (manager) => {
        await this.applyEntries(manager, targetEntries, false);
      });
      const targetSet = new Set(targetEntries);
      const completed: BlogLegacyAssetMigrationManifest = {
        ...manifest,
        entries: manifest.entries.map((entry) => {
          if (targetSet.has(entry)) {
            return {
              ...entry,
              status: 'completed',
            };
          }
          return entry;
        }),
        status: 'completed',
        updatedAt: new Date().toISOString(),
      };
      await this.manifestStore.write(options.manifestPath, completed);
      return completed;
    } catch (error) {
      const targetSet = new Set(targetEntries);
      const failed: BlogLegacyAssetMigrationManifest = {
        ...manifest,
        entries: manifest.entries.map((entry) => {
          if (targetSet.has(entry)) {
            return {
              ...entry,
              status: 'failed',
            };
          }
          return entry;
        }),
        status: 'failed',
        updatedAt: new Date().toISOString(),
      };
      await this.manifestStore.write(options.manifestPath, failed);
      throw error;
    }
  }

  /**
   * 校验`options`是否满足博客旧版资源迁移记录约束，并拒绝不合法输入；从 `readManifest` 读取博客旧版资源迁移记录。
   * @param options - 控制博客旧版资源迁移记录筛选、缓存或输出方式的可选项，包含 `manifestPath` 字段。
   * @returns 博客旧版资源迁移记录。
   * @throws 当 `!containsValue(value, entry.publicUrl)` 成立时拒绝当前输入并抛出 `Error`；当 `object.stat.size !== entry.size || hash !== entry.contentSha256 || mime…` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `failed` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async verify(
    options: BlogLegacyAssetMigrationOptions,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    const manifest = await this.readManifest(options.manifestPath);
    const entries: BlogLegacyAssetMigrationEntry[] = [];
    let failed = false;

    for (const entry of manifest.entries) {
      try {
        const value = await this.readEntryValue(entry);
        if (!containsValue(value, entry.publicUrl)) {
          throw new Error('数据库字段未指向迁移资源');
        }
        const object = await this.minioClientService.getObject(entry.objectKey);
        const hash = await hashStream(object.stream, entry.size);
        const mimeType = readMinioMimeType(object.stat.metaData);
        if (
          object.stat.size !== entry.size ||
          hash !== entry.contentSha256 ||
          mimeType !== entry.mimeType
        ) {
          throw new Error('MinIO 对象与 manifest 不一致');
        }
        entries.push({
          ...entry,
          status: 'verified',
        });
      } catch {
        failed = true;
        entries.push({
          ...entry,
          status: 'failed',
        });
      }
    }

    const verified: BlogLegacyAssetMigrationManifest = {
      ...manifest,
      entries,
      mode: 'verify',
      status: (() => {
        if (failed) {
          return 'failed';
        }
        return 'verified';
      })(),
      updatedAt: new Date().toISOString(),
    };
    await this.manifestStore.write(options.manifestPath, verified);
    if (failed) throw new Error('Blog 旧资源迁移验证失败');
    return verified;
  }

  /**
   * 以统一异常拒绝回滚。
   * @param options - 控制以统一异常拒绝回滚筛选、缓存或输出方式的可选项，包含 `manifestPath` 字段。
   * @returns 以统一异常拒绝回滚。
   * @throws 当 `dataSource.transaction` 或 `manifest.entries.map` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async rollback(
    options: BlogLegacyAssetMigrationOptions,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    const manifest = await this.readManifest(options.manifestPath);
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.applyEntries(manager, manifest.entries, true);
      });
      const rolledBack: BlogLegacyAssetMigrationManifest = {
        ...manifest,
        entries: manifest.entries.map((entry) => ({
          ...entry,
          status: 'rolled-back',
        })),
        mode: 'rollback',
        status: 'rolled-back',
        updatedAt: new Date().toISOString(),
      };
      await this.manifestStore.write(options.manifestPath, rolledBack);
      return rolledBack;
    } catch (error) {
      const failed: BlogLegacyAssetMigrationManifest = {
        ...manifest,
        entries: manifest.entries.map((entry) => ({
          ...entry,
          status: 'failed',
        })),
        mode: 'rollback',
        status: 'failed',
        updatedAt: new Date().toISOString(),
      };
      await this.manifestStore.write(options.manifestPath, failed);
      throw error;
    }
  }

  /**
   * 按`path`读取清单；先通过 `assertBlogLegacyAssetMigrationManifest` 校验输入边界。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 清单。
   * @throws 当 `manifest.entries.some( (entry) => !this.fetcher.isAllowedSourceUrl(entr…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  private async readManifest(
    path: string,
  ): Promise<BlogLegacyAssetMigrationManifest> {
    const manifest = await this.manifestStore.read(path);
    assertBlogLegacyAssetMigrationManifest(manifest);
    assertManifestEntrySetSafety(manifest.entries);
    if (
      manifest.entries.some(
        (entry) => !this.fetcher.isAllowedSourceUrl(entry.oldUrl),
      )
    ) {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest 旧资源 URL 不在精确 allowlist 中',
      );
    }
    return manifest;
  }

  /**
   * 根据`manager`、`entries`、`rollback`更新条目；把变更持久化到当前存储（`repository.update`）。
   * @param manager - 保证条目读写处于同一事务中的实体管理器。
   * @param entries - 按原有顺序参与条目筛选、合并或汇总的集合。
   * @param rollback - 决定是否启用“rollback”分支的布尔选项。
   * @throws 当 `!article` 成立时拒绝当前输入并抛出 `Error`；当 `!theme` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async applyEntries(
    manager: EntityManager,
    entries: BlogLegacyAssetMigrationEntry[],
    rollback: boolean,
  ): Promise<void> {
    const groups = groupEntries(entries);
    for (const group of groups) {
      if (group.table === 'blog_article') {
        const repository = manager.getRepository(BlogArticle);
        const article = await repository.findOne({
          lock: {
            mode: 'pessimistic_write',
          },
          where: {
            id: group.rowId,
          },
        });
        if (!article) throw new Error('Blog 文章迁移目标不存在');
        const entityField = toArticleEntityField(group.field);
        const current = article[entityField];
        const next = replaceEntryUrls(current, group.entries, rollback);
        if (next !== current) {
          await repository.update(
            {
              id: group.rowId,
            },
            {
              [entityField]: next,
            },
          );
        }
      } else {
        const repository = manager.getRepository(BlogThemeConfig);
        const theme = await repository.findOne({
          lock: {
            mode: 'pessimistic_write',
          },
          where: {
            id: group.rowId,
          },
        });
        if (!theme) throw new Error('Blog 主题迁移目标不存在');
        const next = replaceEntryUrls(theme.config, group.entries, rollback);
        await repository.update(
          {
            id: group.rowId,
          },
          {
            config: next,
          },
        );
      }
    }
  }

  /**
   * 按`entry`读取条目值；当 `entry.table === 'blog_article'` 成立时返回 `article[toArticleEntityField(entry.field)]`。
   * @param entry - 用于条目值的领域对象，包含 `table`、`rowId`、`field` 字段。
   * @returns 条目值。
   * @throws 当 `!article` 成立时拒绝当前输入并抛出 `Error`；当 `!theme` 成立时拒绝当前输入并抛出 `Error`。
   */
  private async readEntryValue(
    entry: BlogLegacyAssetMigrationEntry,
  ): Promise<unknown> {
    if (entry.table === 'blog_article') {
      const article = await this.articleRepository.findOne({
        where: {
          id: entry.rowId,
        },
      });
      if (!article) throw new Error('Blog 文章迁移目标不存在');
      return article[toArticleEntityField(entry.field)];
    }
    const theme = await this.themeRepository.findOne({
      where: {
        id: entry.rowId,
      },
    });
    if (!theme) throw new Error('Blog 主题迁移目标不存在');
    return theme.config;
  }

  /**
   * 校验`options`是否满足破坏性的安全性约束，并拒绝不合法输入；从 `configService.get` 读取破坏性的安全性。
   * @param options - 控制破坏性的安全性筛选、缓存或输出方式的可选项，包含 `mode`、`databaseIdentity`、`maintenanceConfirmed`、`backupPath` 字段。
   * @throws 当 `!options.databaseIdentity` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `!host || !database` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `options.databaseIdentity !== `${host}:${port}/${database}`` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
   *   当 `!options.maintenanceConfirmed` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `!options.backupPath` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
   */
  private assertDestructiveSafety(
    options: BlogLegacyAssetMigrationOptions,
  ): void {
    if (!['execute', 'resume', 'rollback'].includes(options.mode)) return;
    if (!options.databaseIdentity) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须提供明确数据库身份`,
      );
    }
    const host = `${this.configService.get('DB_HOST') || ''}`.trim();
    const port = `${this.configService.get('DB_PORT') || '3306'}`.trim();
    const database = `${this.configService.get('DB_DATABASE') || ''}`.trim();
    if (!host || !database) {
      throw new BlogLegacyAssetMigrationUsageError('数据库连接身份不完整');
    }
    if (options.databaseIdentity !== `${host}:${port}/${database}`) {
      throw new BlogLegacyAssetMigrationUsageError(
        '数据库身份与当前连接不一致',
      );
    }
    if (!options.maintenanceConfirmed) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须确认维护窗口`,
      );
    }
    if (!options.backupPath) {
      throw new BlogLegacyAssetMigrationUsageError(
        `${options.mode} 模式必须提供现有备份路径`,
      );
    }
  }
}

export const defaultBlogLegacyAssetDnsResolver: BlogLegacyAssetDnsResolver = (
  hostname,
) =>
  dnsLookup(hostname, {
    all: true,
    verbatim: true,
  });

export const defaultBlogLegacyAssetRawHttpRequest: BlogLegacyAssetRawHttpRequest =
  async ({ address, family, maxBytes, timeoutMs, url }) => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address, family }]);
        return;
      }
      callback(null, address, family);
    };
    const agent = (() => {
      if (url.protocol === 'https:') {
        return new HttpsAgent({ keepAlive: false, lookup });
      }
      return new HttpAgent({ keepAlive: false, lookup });
    })();
    try {
      const response = await axios.request<ArrayBuffer>({
        decompress: true,
        headers: {
          Accept:
            'image/avif,image/webp,image/png,image/jpeg,image/gif,font/woff2,font/woff,*/*;q=0.1',
        },
        httpAgent: agent,
        httpsAgent: agent,
        maxBodyLength: maxBytes,
        maxContentLength: maxBytes,
        maxRedirects: 0,
        method: 'GET',
        proxy: false,
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        transitional: {
          clarifyTimeoutError: true,
        },
        url: url.toString(),
        validateStatus: () => true,
      });
      return {
        body: Buffer.from(response.data || new ArrayBuffer(0)),
        headers: response.headers as Record<
          string,
          string | string[] | undefined
        >,
        status: response.status,
      };
    } finally {
      agent.destroy();
    }
  };

/**
 * 从`value`解析从输入中提取URL；当 `typeof value === 'string'` 成立时返回 `[...value.matchAll(URL_PATTERN)] .map((matc…`。
 * @param value - 参与从输入中提取URL比较、格式化或输出的候选值。
 * @returns 按输入顺序得到的从输入中提取URL列表；没有匹配项时为空数组。
 */
function extractUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(URL_PATTERN)]
      .map((match) => trimUrlPunctuation(match[0]))
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractUrls(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => extractUrls(item));
  }
  return [];
}

/**
 * 校验`value`是否满足博客旧版资源迁移清单约束，并拒绝不合法输入；先通过 `assertManifestEntrySetSafety` 校验输入边界。
 * @param value - 参与博客旧版资源迁移清单比较、格式化或输出的候选值。
 * @throws 当 `!isRecord(value)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `value.version !== 1 || !isIsoTimestamp(value.createdAt) || !isIsoTimest…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!MANIFEST_MODES.has(value.mode) || !MANIFEST_STATUSES.has(value.status)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!Array.isArray(value.entries)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `!isRecord(entry)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `typeof entryBasename !== 'string' || !SAFE_BASENAME_PATTERN.test(entryB…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `typeof mimeType !== 'string' || !SAFE_MIME_TYPES.has(mimeType)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `typeof rowId !== 'string'` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `rowId.length < 1 || rowId.length > 128 || /[\u0000-\u001f\u007f]/u.test…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!Number.isInteger(size) || (size as number) < 0 || (size as number) > 1…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!MANIFEST_ENTRY_STATUSES.has(status)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `!ARTICLE_MANIFEST_FIELDS.has(field)` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；当 `field !== 'config'` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `table === 'blog_theme_config'` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `objectKey !== `blog/migrated/${contentSha256}/${entryBasename}` || publ…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
 */
function assertBlogLegacyAssetMigrationManifest(
  value: unknown,
): asserts value is BlogLegacyAssetMigrationManifest {
  if (!isRecord(value)) {
    throw new BlogLegacyAssetMigrationUsageError('manifest 格式无效');
  }
  if (
    value.version !== 1 ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    throw new BlogLegacyAssetMigrationUsageError('manifest 格式无效');
  }
  if (!MANIFEST_MODES.has(value.mode) || !MANIFEST_STATUSES.has(value.status)) {
    throw new BlogLegacyAssetMigrationUsageError('manifest 格式无效');
  }
  if (!Array.isArray(value.entries)) {
    throw new BlogLegacyAssetMigrationUsageError('manifest 格式无效');
  }

  for (const entry of value.entries) {
    if (!isRecord(entry)) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    const {
      basename: entryBasename,
      contentSha256,
      field,
      mimeType,
      objectKey,
      oldUrl,
      publicUrl,
      rowId,
      size,
      status,
      table,
    } = entry;
    if (
      typeof entryBasename !== 'string' ||
      !SAFE_BASENAME_PATTERN.test(entryBasename) ||
      typeof contentSha256 !== 'string' ||
      !SHA256_PATTERN.test(contentSha256)
    ) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (typeof mimeType !== 'string' || !SAFE_MIME_TYPES.has(mimeType)) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (typeof rowId !== 'string') {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (
      rowId.length < 1 ||
      rowId.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(rowId)
    ) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (
      !Number.isInteger(size) ||
      (size as number) < 0 ||
      (size as number) > 100 * 1024 * 1024
    ) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (!MANIFEST_ENTRY_STATUSES.has(status)) {
      throw new BlogLegacyAssetMigrationUsageError('manifest entry 格式无效');
    }
    if (table === 'blog_article') {
      if (!ARTICLE_MANIFEST_FIELDS.has(field)) {
        throw new BlogLegacyAssetMigrationUsageError(
          'manifest entry 表字段身份无效',
        );
      }
    } else if (table === 'blog_theme_config') {
      if (field !== 'config') {
        throw new BlogLegacyAssetMigrationUsageError(
          'manifest entry 表字段身份无效',
        );
      }
    } else {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest entry 表字段身份无效',
      );
    }
    if (
      objectKey !== `blog/migrated/${contentSha256}/${entryBasename}` ||
      publicUrl !== `/api/blog/asset/${contentSha256}/${entryBasename}` ||
      !isSafeManifestOldUrl(oldUrl)
    ) {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest entry 派生路径无效',
      );
    }
  }
  assertManifestEntrySetSafety(
    value.entries as BlogLegacyAssetMigrationEntry[],
  );
}

/**
 * 校验`entries`是否满足清单条目集合安全性约束，并拒绝不合法输入；从 `objectMetadata.get` 读取清单条目集合安全性。
 * @param entries - 按原有顺序参与清单条目集合安全性筛选、合并或汇总的集合。
 * @throws 当 `existingObject && (existingObject.contentSha256 !== entry.contentSha256…` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `existingOldUrl && existingOldUrl !== entry.oldUrl` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`；
 *   当 `existingPublicUrl && existingPublicUrl !== entry.publicUrl` 成立时拒绝当前输入并抛出 `BlogLegacyAssetMigrationUsageError`。
 */
function assertManifestEntrySetSafety(
  entries: BlogLegacyAssetMigrationEntry[],
): void {
  const objectMetadata = new Map<
    string,
    {
      contentSha256: string;
      mimeType: string;
      size: number;
    }
  >();
  const groupPublicUrls = new Map<string, string>();
  const groupOldUrls = new Map<string, string>();

  for (const entry of entries) {
    const existingObject = objectMetadata.get(entry.objectKey);
    if (
      existingObject &&
      (existingObject.contentSha256 !== entry.contentSha256 ||
        existingObject.mimeType !== entry.mimeType ||
        existingObject.size !== entry.size)
    ) {
      throw new BlogLegacyAssetMigrationUsageError('manifest 对象元数据冲突');
    }
    objectMetadata.set(entry.objectKey, {
      contentSha256: entry.contentSha256,
      mimeType: entry.mimeType,
      size: entry.size,
    });

    const groupIdentity = [entry.table, entry.rowId, entry.field].join(
      '\u0000',
    );
    const publicIdentity = `${groupIdentity}\u0000${entry.publicUrl}`;
    const existingOldUrl = groupPublicUrls.get(publicIdentity);
    if (existingOldUrl && existingOldUrl !== entry.oldUrl) {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest URL 映射冲突且不可逆',
      );
    }
    groupPublicUrls.set(publicIdentity, entry.oldUrl);

    const oldIdentity = `${groupIdentity}\u0000${entry.oldUrl}`;
    const existingPublicUrl = groupOldUrls.get(oldIdentity);
    if (existingPublicUrl && existingPublicUrl !== entry.publicUrl) {
      throw new BlogLegacyAssetMigrationUsageError(
        'manifest URL 映射冲突且不可逆',
      );
    }
    groupOldUrls.set(oldIdentity, entry.publicUrl);
  }
}

/**
 * 根据`value`与当前约束判定记录。
 * @param value - 待判定是否满足记录约束的候选值。
 * @returns 满足记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 根据`value`与当前约束判定ISO时间戳。
 * @param value - 待判定是否满足ISO时间戳约束的候选值。
 * @returns 满足ISO时间戳约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/**
 * 根据`value`与当前约束判定安全清单旧的URL。
 * @param value - 待判定是否满足安全清单旧的URL约束的候选值。
 * @returns 满足安全清单旧的URL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isSafeManifestOldUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * 按`metaData`读取MinIOMIME类型；当 `typeof value === 'string'` 成立时返回 `value.split(';')[0].trim().toLowerCase()`。
 * @param metaData - 用于MinIOMIME类型的领域对象，包含 `'content-type'`、`'Content-Type'` 字段。
 * @returns 当前状态对应的MinIOMIME类型，取值为 `''`。
 */
function readMinioMimeType(metaData: unknown): string {
  if (!isRecord(metaData)) return '';
  const value = metaData['content-type'] ?? metaData['Content-Type'];
  if (typeof value === 'string') {
    return value.split(';')[0].trim().toLowerCase();
  }
  return '';
}

/**
 * 将`value`规范为裁剪URL标点符号，使等价输入得到一致表示。
 * @param value - 参与裁剪URL标点符号比较、格式化或输出的候选值。
 * @returns 裁剪URL标点符号。
 */
function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;}\]]+$/u, '');
}

/**
 * 根据`value`构造安全基础文件名；当 `SAFE_BASENAME_PATTERN.test(normalized)` 成立时返回 `normalized`。
 * @param value - 参与安全基础文件名比较、格式化或输出的候选值。
 * @returns 当前状态对应的安全基础文件名，取值为 `'asset'`。
 */
function createSafeBasename(value: string): string {
  let source = 'asset';
  try {
    source = decodeURIComponent(basename(new URL(value).pathname)) || 'asset';
  } catch {
    source = basename(new URL(value).pathname) || 'asset';
  }
  const normalized = source
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .slice(0, 200);
  if (SAFE_BASENAME_PATTERN.test(normalized)) {
    return normalized;
  }
  return 'asset';
}

/**
 * 按请求头名读取首个字符串值；数组仅取第一项，缺失或非字符串输入保留空值。
 * @param headers - 用于按请求头名读取首个字符串值的领域对象，包含 `name`、`name.toLowerCase()` 字段。
 * @param name - 决定按请求头名读取首个字符串值内容、边界或目标的 `name` 值。
 * @returns 按请求头名读取首个字符串值。
 */
function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * 根据`address`与当前约束判定禁止的地址；当 `bytes.slice(0, 10).every((value) => value === 0) && bytes[10]…` 成立时返回 `isForbiddenIpv4(bytes.slice(12).join('.'))`。
 * @param address - 决定禁止的地址内容、边界或目标的 `address` 值。
 * @returns 满足禁止的地址约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family !== 6) return true;
  const bytes = parseIpv6(address);
  if (!bytes) return true;
  if (
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return isForbiddenIpv4(bytes.slice(12).join('.'));
  }
  if (bytes.every((value) => value === 0)) return true;
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) {
    return true;
  }
  if (bytes.slice(0, 12).every((value) => value === 0)) {
    return isForbiddenIpv4(bytes.slice(12).join('.'));
  }
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  return bytes[0] === 0xff;
}

/**
 * 根据`address`与当前约束判定禁止的IPv4；当 `parts.length !== 4 || parts.some((value) => !Number.isInteger…` 成立时返回 `true`。
 * @param address - 决定禁止的IPv4内容、边界或目标的 `address` 值。
 * @returns 满足禁止的IPv4约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isForbiddenIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

/**
 * 从`address`解析Ipv6；当 `missing < 0 || (separatorIndex < 0 && head.length !== 8) || (…` 成立时返回 `undefined`。
 * @param address - 决定Ipv6内容、边界或目标的 `address` 值。
 * @returns 按输入顺序得到的Ipv6列表；没有可用结果或提前结束时为 `undefined`，没有匹配项时为空数组。
 */
function parseIpv6(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split('%')[0];
  const separatorIndex = normalized.indexOf('::');
  if (separatorIndex !== normalized.lastIndexOf('::')) return undefined;
  const [headValue, tailValue] = (() => {
    if (separatorIndex >= 0) {
      return [
        normalized.slice(0, separatorIndex),
        normalized.slice(separatorIndex + 2),
      ];
    }
    return [normalized, ''];
  })();
  const head = expandIpv6Parts(headValue);
  const tail = expandIpv6Parts(tailValue);
  if (!head || !tail) return undefined;
  const missing = (() => {
    if (separatorIndex >= 0) {
      return 8 - head.length - tail.length;
    }
    return 0;
  })();
  if (
    missing < 0 ||
    (separatorIndex < 0 && head.length !== 8) ||
    (separatorIndex >= 0 && missing < 1)
  ) {
    return undefined;
  }
  const groups = [...head, ...Array(missing).fill(0), ...tail];
  if (groups.length !== 8) return undefined;
  return groups.flatMap((value) => [(value >> 8) & 0xff, value & 0xff]);
}

/**
 * 根据`value`处理展开IPv6部分；当 `last?.includes('.')` 成立时返回 `undefined`。
 * @param value - 参与展开IPv6部分比较、格式化或输出的候选值。
 * @returns 按输入顺序得到的展开IPv6部分列表；没有可用结果或提前结束时为 `undefined`，没有匹配项时为空数组。
 */
function expandIpv6Parts(value: string): number[] | undefined {
  if (!value) return [];
  const parts = value.split(':');
  const last = parts.at(-1);
  if (last?.includes('.')) {
    if (isIP(last) !== 4) return undefined;
    const bytes = last.split('.').map(Number);
    parts.splice(
      parts.length - 1,
      1,
      ((bytes[0] << 8) | bytes[1]).toString(16),
      ((bytes[2] << 8) | bytes[3]).toString(16),
    );
  }
  const groups = parts.map((part) => Number.parseInt(part, 16));
  if (
    groups.some(
      (group, index) =>
        !/^[0-9a-f]{1,4}$/u.test(parts[index]) ||
        !Number.isInteger(group) ||
        group < 0 ||
        group > 0xffff,
    )
  ) {
    return undefined;
  }
  return groups;
}

/**
 * 把匹配项汇总为分组条目。
 * @param entries - 按原有顺序参与把匹配项汇总为分组条目筛选、合并或汇总的集合。
 * @returns 按输入顺序得到的把匹配项汇总为分组条目列表；没有匹配项时为空数组。
 */
function groupEntries(entries: BlogLegacyAssetMigrationEntry[]) {
  const groups = new Map<
    string,
    {
      entries: BlogLegacyAssetMigrationEntry[];
      field: BlogLegacyAssetMigrationField;
      rowId: string;
      table: BlogLegacyAssetMigrationTable;
    }
  >();
  for (const entry of entries) {
    const key = [entry.table, entry.rowId, entry.field].join('\u0000');
    const group = groups.get(key) || {
      entries: [],
      field: entry.field,
      rowId: entry.rowId,
      table: entry.table,
    };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * 将输入收敛并投影为文章实体字段。
 * @param field - 决定文章实体字段内容、边界或目标的 `field` 值。
 * @returns 文章实体字段。
 * @throws 当 `!mapping` 成立时拒绝当前输入并抛出 `Error`。
 */
function toArticleEntityField(
  field: BlogLegacyAssetMigrationField,
): ArticleField {
  const mapping = ARTICLE_FIELD_MAP.find(
    (candidate) => candidate.manifestField === field,
  );
  if (!mapping) throw new Error('Blog 文章迁移字段无效');
  return mapping.entityField;
}

/**
 * 根据`value`、`entries`、`rollback`处理替换条目URL。
 * @param value - 包含旧地址或公开地址的当前字段值；替换过程从该值开始并保留非目标内容。
 * @param entries - 按原有顺序参与替换条目URL筛选、合并或汇总的集合。
 * @param rollback - 决定是否启用“rollback”分支的布尔选项。
 * @returns 替换条目URL。
 * @throws 当 `!result.foundFrom && !result.foundTo` 成立时拒绝当前输入并抛出 `Error`。
 */
function replaceEntryUrls(
  value: unknown,
  entries: BlogLegacyAssetMigrationEntry[],
  rollback: boolean,
): any {
  let next = value;
  const orderedEntries = [...entries].sort((left, right) => {
    const leftFrom = (() => {
      if (rollback) {
        return left.publicUrl;
      }
      return left.oldUrl;
    })();
    const rightFrom = (() => {
      if (rollback) {
        return right.publicUrl;
      }
      return right.oldUrl;
    })();
    return rightFrom.length - leftFrom.length;
  });
  for (const entry of orderedEntries) {
    const from = (() => {
      if (rollback) {
        return entry.publicUrl;
      }
      return entry.oldUrl;
    })();
    const to = (() => {
      if (rollback) {
        return entry.oldUrl;
      }
      return entry.publicUrl;
    })();
    const result = replaceSingleEntryUrl(next, from, to);
    if (!result.foundFrom && !result.foundTo) {
      throw new Error('Blog 迁移字段已发生并发变化');
    }
    next = result.value;
  }
  return next;
}

/**
 * 根据`value`、`from`、`to`拼接稳定的替换单一的条目URL，用于隔离对应资源或存储记录；当 `typeof value === 'string'` 成立时返回 `{ foundFrom, foundTo: value.includes(to), v…`。
 * @param value - 参与替换单一的条目URL比较、格式化或输出的候选值。
 * @param from - 决定替换单一的条目URL内容、边界或目标的 `from` 值。
 * @param to - 决定替换单一的条目URL内容、边界或目标的 `to` 值。
 * @returns 包含 `foundFrom`、`foundTo`、`value` 字段的替换单一的条目URL。
 */
function replaceSingleEntryUrl(
  value: unknown,
  from: string,
  to: string,
): {
  foundFrom: boolean;
  foundTo: boolean;
  value: any;
} {
  if (typeof value === 'string') {
    const foundFrom = value.includes(from);
    return {
      foundFrom,
      foundTo: value.includes(to),
      value: (() => {
        if (foundFrom) {
          return value.split(from).join(to);
        }
        return value;
      })(),
    };
  }
  if (Array.isArray(value)) {
    const children = value.map((item) => replaceSingleEntryUrl(item, from, to));
    return {
      foundFrom: children.some((child) => child.foundFrom),
      foundTo: children.some((child) => child.foundTo),
      value: children.map((child) => child.value),
    };
  }
  if (value && typeof value === 'object') {
    const children = Object.entries(value).map(([key, item]) => [
      key,
      replaceSingleEntryUrl(item, from, to),
    ]) as Array<
      [
        string,
        {
          foundFrom: boolean;
          foundTo: boolean;
          value: any;
        },
      ]
    >;
    return {
      foundFrom: children.some(([, child]) => child.foundFrom),
      foundTo: children.some(([, child]) => child.foundTo),
      value: Object.fromEntries(
        children.map(([key, child]) => [key, child.value]),
      ),
    };
  }
  return {
    foundFrom: false,
    foundTo: false,
    value,
  };
}

/**
 * 按当前约束判定包含值。
 * @param value - 参与包含值比较、格式化或输出的候选值。
 * @param expected - 决定包含值内容、边界或目标的 `expected` 值。
 * @returns 满足包含值约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function containsValue(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value.includes(expected);
  if (Array.isArray(value)) {
    return value.some((item) => containsValue(item, expected));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsValue(item, expected));
  }
  return false;
}

/**
 * 根据`stream`、`expectedSize`与当前约束判定流摘要。
 * @param stream - 用于流摘要的领域对象，包含 `destroy` 字段。
 * @param expectedSize - 限制流摘要数量、尺寸、等级或重试边界的数值。
 * @returns 满足流摘要约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 * @throws 当 `size > expectedSize` 成立时拒绝当前输入并抛出 `Error`；当 `size !== expectedSize` 成立时拒绝当前输入并抛出 `Error`。
 */
async function hashStream(stream: Readable, expectedSize: number) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of stream) {
    const buffer = (() => {
      if (Buffer.isBuffer(chunk)) {
        return chunk;
      }
      return Buffer.from(chunk);
    })();
    size += buffer.length;
    if (size > expectedSize) {
      stream.destroy();
      throw new Error('MinIO 对象大小超过 manifest');
    }
    hash.update(buffer);
  }
  if (size !== expectedSize)
    throw new Error('MinIO 对象大小与 manifest 不一致');
  return hash.digest('hex');
}

/**
 * 根据`promise`、`timeoutMs`处理在超时期间执行传入操作。
 * @param promise - 决定在超时期间执行传入操作内容、边界或目标的 `promise` 值。
 * @param timeoutMs - 用于在超时期间执行传入操作超时、有效期或退避计算的毫秒数。
 * @returns 在超时期间执行传入操作。
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new BlogLegacyAssetMigrationUsageError('资源下载超时')),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
