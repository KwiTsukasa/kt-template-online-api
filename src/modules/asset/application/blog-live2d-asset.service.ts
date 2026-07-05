import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioClientService } from './asset-minio.service';
import type {
  BlogLive2DAssetResult,
  BlogLive2DRuntimeAssetPath,
} from '../domain/blog-live2d-asset.types';

const DEFAULT_ALLOWED_ORIGINS = 'https://blog.kwitsukasa.top';
const DEFAULT_LIVE2D_BUCKET = 'kt-template-online';
const DEFAULT_LIVE2D_PREFIX = 'blog/live2d/pio';
const MAX_DECODE_DEPTH = 6;

/**
 * Detects MinIO/S3 object-missing errors from `statObject` and `getObject`.
 * @param error - Unknown failure thrown by the MinIO client while resolving a runtime object.
 * @returns `true` when the failure means the requested object key does not exist.
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
  /**
   * Creates the guarded Blog Live2D asset service.
   * @param minioClientService - Existing MinIO helper used to stream versioned Pio runtime files.
   * @param configService - Runtime config source for bucket, object prefix, and allowed browser origins.
   */
  constructor(
    private readonly minioClientService: MinioClientService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Rejects browser asset requests that do not come from the configured Blog origins.
   * @param referer - Browser Referer header; used for normal `<script>/<img>/<canvas>` asset loads.
   * @param origin - Browser Origin header; used by CORS-capable requests when Referer is absent.
   */
  assertAllowedRequest(referer?: string, origin?: string): void {
    const candidates = [referer, origin].filter(Boolean) as string[];
    if (!candidates.length) {
      throw new BadRequestException('Live2D asset referer is required');
    }

    const allowed = this.getAllowedOrigins();
    const allSourcesAllowed = candidates.every((candidate) =>
      allowed.includes(this.toOrigin(candidate)),
    );

    if (!allSourcesAllowed) {
      throw new BadRequestException('Live2D asset request is not allowed');
    }
  }

  /**
   * Streams one Pio runtime asset from the configured MinIO bucket and prefix.
   * @param version - Runtime release segment such as `v1`; kept separate from object path to prevent route traversal.
   * @param objectPath - Route tail below the version, including nested paths such as `textures/texture_00.png`.
   * @returns MinIO stream and stat metadata for the requested object.
   */
  async getRuntimeObject(
    version: string,
    objectPath: BlogLive2DRuntimeAssetPath,
  ): Promise<BlogLive2DAssetResult> {
    try {
      return await this.minioClientService.getObject(
        this.resolveRuntimeObjectPath(version, objectPath),
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
   * Streams the Pio root catalog from the configured MinIO prefix.
   * @returns MinIO stream and stat metadata for `catalog.json`.
   */
  async getCatalogObject(): Promise<BlogLive2DAssetResult> {
    try {
      return await this.minioClientService.getObject(
        [...this.getPrefixSegments(), 'catalog.json'].join('/'),
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
   * Builds the MinIO object key for a versioned Pio runtime file.
   * @param version - Runtime release segment supplied by the route.
   * @param objectPath - Route tail supplied by the wildcard parameter.
   * @returns Full MinIO object key under the configured Pio prefix.
   */
  resolveRuntimeObjectPath(
    version: string,
    objectPath: BlogLive2DRuntimeAssetPath,
  ): string {
    const prefix = this.getPrefixSegments();
    const versionSegment = this.normalizeRouteSegments(version, 'version');
    const assetSegments = this.normalizeRouteSegments(objectPath, 'asset path');

    return [...prefix, ...versionSegment, ...assetSegments].join('/');
  }

  /**
   * @returns Configured MinIO bucket for Blog Live2D runtime files.
   */
  private getBucketName(): string {
    return (
      this.configService.get<string>('BLOG_LIVE2D_BUCKET') ||
      this.minioClientService.getDefaultBucket?.() ||
      DEFAULT_LIVE2D_BUCKET
    );
  }

  /**
   * @returns Sanitized MinIO object-key prefix for Pio runtime files.
   */
  private getPrefixSegments(): string[] {
    return this.normalizeRouteSegments(
      this.configService.get<string>('BLOG_LIVE2D_PREFIX') ||
        DEFAULT_LIVE2D_PREFIX,
      'prefix',
    );
  }

  /**
   * @returns Allowed absolute origins for Blog Live2D asset requests.
   */
  private getAllowedOrigins(): string[] {
    return (
      this.configService.get<string>('BLOG_LIVE2D_ALLOWED_ORIGINS') ||
      DEFAULT_ALLOWED_ORIGINS
    )
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => this.toOrigin(item));
  }

  /**
   * Converts a header value or configured URL to an absolute origin string.
   * @param value - Referer, Origin, or allowlist entry that must parse as an HTTP(S) URL.
   * @returns Protocol and host pair used for allowlist comparison.
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
   * Normalizes route and config path values into safe object-key segments.
   * @param input - String or wildcard array supplied by Nest/path-to-regexp or runtime config.
   * @param label - Human-readable source name used in the rejection message.
   * @returns Decoded path segments with traversal, absolute URL, and backslash escapes rejected.
   */
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

  /**
   * Decodes route path text until stable so encoded traversal cannot pass through.
   * @param value - Raw path text from a route segment or config value.
   * @param label - Human-readable source name used in the rejection message.
   * @returns Fully decoded path text when decoding converges within the bounded depth.
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

