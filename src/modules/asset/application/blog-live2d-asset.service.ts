import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ClientIpService } from '@/common';
import { MinioClientService } from './asset-minio.service';
import type {
  BlogLive2DAssetResult,
  BlogLive2DCharacter,
  BlogLive2DRuntimeAssetPath,
} from '../domain/blog-live2d-asset.types';

const LEGACY_BLOG_ORIGIN = 'https://blog.kwitsukasa.top';
const NATMAP_PUBLIC_HOSTNAME = 'nas4.kwitsukasa.top';
const DEFAULT_LIVE2D_BUCKET = 'kt-template-online';
const DEFAULT_LIVE2D_ROOT_PREFIX = 'blog/live2d';
const DEFAULT_LIVE2D_PREFIX = 'blog/live2d/pio';
const MAX_DECODE_DEPTH = 6;
const ALLOWED_LIVE2D_CHARACTERS = new Set(['pio', 'tia']);
const ALLOWED_RUNTIME_FAMILIES = new Set(['moc', 'moc3']);

/**
 * 根据`error`与当前约束判定MinIO 对象是否不存在；当 `!error || typeof error !== 'object'` 成立时返回 `false`。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 满足MinIO 对象是否不存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isMinioObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'NotFound' ||
    candidate.code === 'NoSuchKey' ||
    candidate.message === 'Not Found'
  );
}

@Injectable()
export class BlogLive2DAssetService {
  constructor(
    private readonly minioClientService: MinioClientService,
    private readonly configService: ConfigService,
    private readonly clientIpService: ClientIpService,
  ) {}

  /**
   * 要求资源请求至少携带一个来源，并确保所有来源均属于旧博客或当前可信公开地址。
   * @param request - 用于推导当前可信公开来源的 HTTP 请求。
   * @param referer - 可选的页面来源请求头，与 `origin` 一并接受同源检查。
   * @param origin - 可选的跨域来源请求头，与 `referer` 一并接受同源检查。
   * @throws 两个来源参数均缺失，或任一来源不在允许集合中时抛出 `BadRequestException`。
   */
  assertAllowedRequest(
    request: Request,
    referer?: string,
    origin?: string,
  ): void {
    const candidates = [referer, origin].filter(Boolean) as string[];
    if (!candidates.length) {
      throw new BadRequestException('Live2D asset referer is required');
    }

    const allowed = new Set([LEGACY_BLOG_ORIGIN]);
    const requestOrigin = this.getAllowedRequestOrigin(request);
    if (requestOrigin) {
      allowed.add(requestOrigin);
    }
    const allSourcesAllowed = candidates.every((candidate) =>
      allowed.has(this.toOrigin(candidate)),
    );

    if (!allSourcesAllowed) {
      throw new BadRequestException('Live2D asset request is not allowed');
    }
  }

  /**
   * 按`character`、`family`、`objectPath`读取运行态对象；从 `minioClientService.getObject` 读取运行态对象。
   * @param character - 决定运行态对象内容、边界或目标的 `character` 值。
   * @param family - 决定运行态对象内容、边界或目标的 `family` 值。
   * @param objectPath - 必须保持在受控根目录内的对象路径。
   * @returns 运行态对象。
   * @throws 当 `isMinioObjectNotFound(error)` 成立时拒绝当前输入并抛出 `NotFoundException`；当 `minioClientService.getObject` 或 `resolveRuntimeObjectPath` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async getRuntimeObject(
    character: string,
    family: string,
    objectPath: BlogLive2DRuntimeAssetPath,
  ): Promise<BlogLive2DAssetResult> {
    try {
      return await this.minioClientService.getObject(
        this.resolveRuntimeObjectPath(character, family, objectPath),
        this.getBucketName(),
      );
    } catch (error) {
      if (isMinioObjectNotFound(error)) {
        throw new NotFoundException('Live2D runtime asset not found');
      }
      throw error;
    }
  }

  /**
   * 按`character`读取目录对象；从 `minioClientService.getObject` 读取目录对象。
   * @param character - 决定目录对象内容、边界或目标的 `character` 值。
   * @returns 目录对象。
   * @throws 当 `isMinioObjectNotFound(error)` 成立时拒绝当前输入并抛出 `NotFoundException`；当 `minioClientService.getObject` 或 `join` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async getCatalogObject(character: string): Promise<BlogLive2DAssetResult> {
    try {
      return await this.minioClientService.getObject(
        [
          ...this.getRootPrefixSegments(),
          this.normalizeCharacter(character),
          'catalog.json',
        ].join('/'),
        this.getBucketName(),
      );
    } catch (error) {
      if (isMinioObjectNotFound(error)) {
        throw new NotFoundException('Live2D runtime asset not found');
      }
      throw error;
    }
  }

  /**
   * 从`character`、`family`、`objectPath`解析运行态对象路径；从 `getRootPrefixSegments` 读取运行态对象路径。
   * @param character - 决定运行态对象路径内容、边界或目标的 `character` 值。
   * @param family - 决定运行态对象路径内容、边界或目标的 `family` 值。
   * @param objectPath - 必须保持在受控根目录内的对象路径。
   * @returns 运行态对象路径。
   */
  resolveRuntimeObjectPath(
    character: string,
    family: string,
    objectPath: BlogLive2DRuntimeAssetPath,
  ): string {
    const prefix = this.getRootPrefixSegments();
    const characterSegment = this.normalizeCharacter(character);
    const familySegment = this.normalizeRuntimeFamily(family);
    const assetSegments = this.normalizeRouteSegments(objectPath, 'asset path');

    return [
      ...prefix,
      characterSegment,
      ...familySegment,
      ...assetSegments,
    ].join('/');
  }

  /**
   * 按当前运行态读取存储桶名称；从 `configService.get` 读取存储桶名称。
   * @returns 规范化后的存储桶名称；主值为空时采用 `DEFAULT_LIVE2D_BUCKET` 兜底。
   */
  private getBucketName(): string {
    return (
      this.configService.get<string>('BLOG_LIVE2D_BUCKET') ||
      this.minioClientService.getDefaultBucket?.() ||
      DEFAULT_LIVE2D_BUCKET
    );
  }

  /**
   * 按当前运行态读取根目录前缀分段；当 `rootPrefix` 成立时返回 `this.normalizeRouteSegments(rootPrefix, 'ro…`。
   * @returns 按输入顺序得到的根目录前缀分段列表；没有匹配项时为空数组。
   */
  private getRootPrefixSegments(): string[] {
    const rootPrefix = this.configService.get<string>(
      'BLOG_LIVE2D_ROOT_PREFIX',
    );
    if (rootPrefix) {
      return this.normalizeRouteSegments(rootPrefix, 'root prefix');
    }

    const legacyPrefix =
      this.configService.get<string>('BLOG_LIVE2D_PREFIX') ||
      DEFAULT_LIVE2D_PREFIX;
    const segments = this.normalizeRouteSegments(legacyPrefix, 'prefix');
    if (segments.at(-1) === 'pio') {
      return segments.slice(0, -1);
    }

    return this.normalizeRouteSegments(
      DEFAULT_LIVE2D_ROOT_PREFIX,
      'root prefix',
    );
  }

  /**
   * 按`request`读取允许的请求来源；当 `url.protocol !== 'https:' || url.hostname !== NATMAP_PUBLIC_H…` 成立时返回 `null`。
   * @param request - 用于允许的请求来源的当前 HTTP 请求。
   * @returns 允许的请求来源；无法解析或未命中时为 `null`。
   */
  private getAllowedRequestOrigin(request: Request): string | null {
    const publicOrigin = this.toOrigin(
      this.clientIpService.getPublicOrigin(request),
    );
    const url = new URL(publicOrigin);

    if (url.protocol !== 'https:' || url.hostname !== NATMAP_PUBLIC_HOSTNAME) {
      return null;
    }
    if (!url.port) return null;

    return publicOrigin;
  }

  /**
   * 解析资源请求来源并只保留协议与主机部分，路径、查询和片段不会参与同源比较。
   * @param value - 待解析的完整来源地址。
   * @returns 由 HTTP 或 HTTPS 协议及主机组成的规范来源。
   * @throws 地址无法解析或协议不是 HTTP 与 HTTPS 时抛出 `BadRequestException`。
   */
  private toOrigin(value: string): string {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('unsupported protocol');
      }
      return `${url.protocol}//${url.host}`;
    } catch {
      throw new BadRequestException('Live2D asset request source is invalid');
    }
  }

  /**
   * 把单个路径段校验为允许公开访问的 Live2D 角色名，未知角色直接拒绝。
   * @param character - 决定把单个路径段校验为允许公开访问的 Live2D 角色名，未知角色直接拒绝内容、边界或目标的 `character` 值。
   * @returns 把单个路径段校验为允许公开访问的 Live2D 角色名，未知角色直接拒绝。
   * @throws 当 `segments.length !== 1 || !ALLOWED_LIVE2D_CHARACTERS.has(segments[0])` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
  private normalizeCharacter(character: string): BlogLive2DCharacter {
    const segments = this.normalizeRouteSegments(character, 'character');
    if (segments.length !== 1 || !ALLOWED_LIVE2D_CHARACTERS.has(segments[0])) {
      throw new BadRequestException('Invalid Live2D character');
    }

    return segments[0] as BlogLive2DCharacter;
  }

  /**
   * 将`input`、`label`规范为路由分段，使等价输入得到一致表示。
   * @param input - 用于路由分段的结构化输入。
   * @param label - 决定路由分段内容、边界或目标的 `label` 值。
   * @returns 按输入顺序得到的路由分段列表；没有匹配项时为空数组。
   * @throws 当 `!decoded || decoded.includes('\\') || decoded.startsWith('/') || decode…` 成立时拒绝当前输入并抛出 `BadRequestException`；
   *   当 `!segments.length || segments.some((segment) => segment === '.' || segme…` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
  private normalizeRouteSegments(
    input: BlogLive2DRuntimeAssetPath,
    label: string,
  ): string[] {
    const raw = (() => {
      if (Array.isArray(input)) {
        return input.join('/');
      }
      return String(input || '');
    })();
    const decoded = this.decodeRepeated(raw.trim(), label);

    if (
      !decoded ||
      decoded.includes('\\') ||
      decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/i.test(decoded)
    ) {
      throw new BadRequestException(`Invalid Live2D ${label}`);
    }

    const segments = decoded.split('/').filter(Boolean);
    if (
      !segments.length ||
      segments.some((segment) => segment === '.' || segment === '..')
    ) {
      throw new BadRequestException(`Invalid Live2D ${label}`);
    }

    return segments;
  }

  /**
   * 将`family`规范为运行态令牌族，使等价输入得到一致表示。
   * @param family - 决定运行态令牌族内容、边界或目标的 `family` 值。
   * @returns 按输入顺序得到的运行态令牌族列表；没有匹配项时为空数组。
   * @throws 当 `segments.length !== 1 || !ALLOWED_RUNTIME_FAMILIES.has(segments[0])` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
  private normalizeRuntimeFamily(family: string): string[] {
    const segments = this.normalizeRouteSegments(family, 'family');
    if (segments.length !== 1 || !ALLOWED_RUNTIME_FAMILIES.has(segments[0])) {
      throw new BadRequestException('Invalid Live2D family');
    }

    return segments;
  }

  /**
   * 最多执行固定轮次的 URI 解码，并在无变化时提前停止；非法编码统一拒绝。
   * @param value - 待重复 URI 解码的文本；内容稳定时提前停止，非法编码会触发请求错误。
   * @param label - 决定重复解码结果内容、边界或目标的 `label` 值。
   * @returns 重复解码。
   * @throws 任一轮 URI 解码失败，或达到最大轮次后内容仍未稳定时抛出 `BadRequestException`。
   */
  private decodeRepeated(value: string, label: string): string {
    try {
      let decoded = value;
      for (let index = 0; index < MAX_DECODE_DEPTH; index += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) {
          return next;
        }
        decoded = next;
      }
    } catch {
      throw new BadRequestException(`Invalid Live2D ${label}`);
    }

    throw new BadRequestException(`Invalid Live2D ${label}`);
  }
}
