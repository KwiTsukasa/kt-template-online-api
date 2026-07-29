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

  private getBucketName(): string {
    return (
      this.configService.get<string>('BLOG_LIVE2D_BUCKET') ||
      this.minioClientService.getDefaultBucket?.() ||
      DEFAULT_LIVE2D_BUCKET
    );
  }

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

  private normalizeCharacter(character: string): BlogLive2DCharacter {
    const segments = this.normalizeRouteSegments(character, 'character');
    if (segments.length !== 1 || !ALLOWED_LIVE2D_CHARACTERS.has(segments[0])) {
      throw new BadRequestException('Invalid Live2D character');
    }

    return segments[0] as BlogLive2DCharacter;
  }

  private normalizeRouteSegments(
    input: BlogLive2DRuntimeAssetPath,
    label: string,
  ): string[] {
    const raw = Array.isArray(input) ? input.join('/') : String(input || '');
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

  private normalizeRuntimeFamily(family: string): string[] {
    const segments = this.normalizeRouteSegments(family, 'family');
    if (segments.length !== 1 || !ALLOWED_RUNTIME_FAMILIES.has(segments[0])) {
      throw new BadRequestException('Invalid Live2D family');
    }

    return segments;
  }

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
