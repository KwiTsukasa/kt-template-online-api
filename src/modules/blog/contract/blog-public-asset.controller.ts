import { pipeline } from 'node:stream/promises';

import {
  BadRequestException,
  Controller,
  Get,
  Head,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiFileDownloadResponse, Public } from '@/common';
import { MinioClientService } from '@/modules/asset/application/asset-minio.service';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

@Controller('blog/asset')
@ApiTags('Blog - 公开资源')
export class BlogPublicAssetController {
  constructor(private readonly minioClientService: MinioClientService) {}

  @Head(':sha256/:basename')
  @ApiOperation({ summary: '读取迁移后的 Blog 公开资源元数据' })
  @ApiParam({ name: 'sha256', example: 'a'.repeat(64) })
  @ApiParam({ name: 'basename', example: 'cover.png' })
  @Public()
  async headAsset(
    @Param('sha256') sha256: string,
    @Param('basename') assetBasename: string,
    @Res() response: Response,
  ) {
    const stat = await this.minioClientService.statObject(
      this.getObjectName(sha256, assetBasename),
    );
    this.setHeaders(response, stat);
    response.end();
  }

  @Get(':sha256/:basename')
  @ApiOperation({ summary: '读取迁移后的 Blog 公开资源' })
  @ApiParam({ name: 'sha256', example: 'a'.repeat(64) })
  @ApiParam({ name: 'basename', example: 'cover.png' })
  @ApiFileDownloadResponse('Blog migrated public asset stream')
  @Public()
  async getAsset(
    @Param('sha256') sha256: string,
    @Param('basename') assetBasename: string,
    @Res() response: Response,
  ) {
    const object = await this.getObject(sha256, assetBasename);
    this.setHeaders(response, object.stat);
    await pipeline(object.stream, response);
  }

  private getObjectName(sha256: string, assetBasename: string) {
    if (
      !SHA256_PATTERN.test(sha256) ||
      !SAFE_BASENAME_PATTERN.test(assetBasename) ||
      assetBasename === '.' ||
      assetBasename === '..'
    ) {
      throw new BadRequestException('Blog 资源路径无效');
    }
    return `blog/migrated/${sha256}/${assetBasename}`;
  }

  private async getObject(sha256: string, assetBasename: string) {
    return this.minioClientService.getObject(
      this.getObjectName(sha256, assetBasename),
    );
  }

  private setHeaders(
    response: Response,
    stat: {
      metaData: Record<string, any>;
      size: number;
    },
  ) {
    const rawMimeType = stat.metaData?.['content-type'];
    const mimeType =
      typeof rawMimeType === 'string' &&
      /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(rawMimeType)
        ? rawMimeType
        : 'application/octet-stream';
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Length', String(stat.size));
    response.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  }
}
