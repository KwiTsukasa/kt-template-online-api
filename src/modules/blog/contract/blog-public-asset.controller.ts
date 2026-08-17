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

  /**
   * 校验公开资源名后执行 MinIO HEAD 查询，并把对象元数据写入无响应体的 HTTP 响应。
   * @param sha256 - 决定head资源内容、边界或目标的 `sha256` 值。
   * @param assetBasename - 决定head资源内容、边界或目标的 `assetBasename` 值。
   * @param response - 包含 `end` 字段的上游服务响应。
   */
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

  /**
   * 按`sha256`、`assetBasename`、`response`读取资源；从 `getObject` 读取资源。
   * @param sha256 - 决定资源内容、边界或目标的 `sha256` 值。
   * @param assetBasename - 决定资源内容、边界或目标的 `assetBasename` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   */
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

  /**
   * 校验 SHA-256 与安全文件名，并拼接迁移资源的固定 MinIO 对象路径。
   * @param sha256 - 决定对象名称内容、边界或目标的 `sha256` 值。
   * @param assetBasename - 决定对象名称内容、边界或目标的 `assetBasename` 值。
   * @returns 按参数编码并拼接完成的对象名称。
   * @throws 当 `!SHA256_PATTERN.test(sha256) || !SAFE_BASENAME_PATTERN.test(assetBasena…` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
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

  /**
   * 按`sha256`、`assetBasename`读取对象；从 `minioClientService.getObject` 读取对象。
   * @param sha256 - 决定对象内容、边界或目标的 `sha256` 值。
   * @param assetBasename - 决定对象内容、边界或目标的 `assetBasename` 值。
   * @returns 对象。
   */
  private async getObject(sha256: string, assetBasename: string) {
    return this.minioClientService.getObject(
      this.getObjectName(sha256, assetBasename),
    );
  }

  /**
   * 根据对象元数据写入内容类型、长度、缓存策略与安全下载响应头。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param stat - 用于请求头的领域对象，包含 `metaData`、`size` 字段。
   */
  private setHeaders(
    response: Response,
    stat: {
      metaData: Record<string, any>;
      size: number;
    },
  ) {
    const rawMimeType = stat.metaData?.['content-type'];
    const mimeType =
      (() => {
        if (typeof rawMimeType === 'string' &&
      /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(rawMimeType)) {
          return rawMimeType;
        }
        return 'application/octet-stream';
      })();
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Length', String(stat.size));
    response.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  }
}
