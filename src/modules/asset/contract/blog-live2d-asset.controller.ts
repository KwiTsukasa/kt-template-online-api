import { Controller, Get, Headers, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApiFileDownloadResponse,
  Public,
  PublicRateLimitService,
} from '@/common';
import { BlogLive2DAssetService } from '../application/blog-live2d-asset.service';
import type { BlogLive2DRuntimeAssetPath } from '../domain/blog-live2d-asset.types';

@Controller('blog/live2d')
@ApiTags('Blog - Live2D')
export class BlogLive2DAssetController {
  constructor(
    private readonly blogLive2DAssetService: BlogLive2DAssetService,
    private readonly publicRateLimitService: PublicRateLimitService,
  ) {}

  /** 读取字符目录。 */
  @Get(':character/catalog.json')
  @ApiOperation({ summary: '获取 Blog Live2D 角色目录规范索引' })
  @ApiParam({ name: 'character', enum: ['pio', 'tia'], example: 'pio' })
  @ApiFileDownloadResponse('Blog Live2D character root catalog stream')
  @Public()
  async getCharacterCatalog(
    @Param('character') character: string,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(req, referer, origin);
    await this.publicRateLimitService.bindLive2DConcurrentLease(req, res);
    const { stream, stat, objectName } =
      await this.blogLive2DAssetService.getCatalogObject(character);

    res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] || 'application/json',
    );
    res.setHeader('Cache-Control', this.getCacheControl(objectName));
    stream.pipe(res);
  }

  /** 读取字符资源。 */
  @Get(':character/:family/*assetPath')
  @ApiOperation({ summary: '获取 Blog Live2D 角色运行时资源' })
  @ApiParam({ name: 'character', enum: ['pio', 'tia'], example: 'tia' })
  @ApiParam({ name: 'family', example: 'moc' })
  @ApiParam({ name: 'assetPath', example: 'textures/default-costume.png' })
  @ApiFileDownloadResponse('Blog Live2D runtime asset stream')
  @Public()
  async getCharacterAsset(
    @Param('character') character: string,
    @Param('family') family: string,
    @Param('assetPath') assetPath: BlogLive2DRuntimeAssetPath,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(req, referer, origin);
    await this.publicRateLimitService.bindLive2DConcurrentLease(req, res);
    const { stream, stat, objectName } =
      await this.blogLive2DAssetService.getRuntimeObject(
        character,
        family,
        assetPath,
      );

    res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] || 'application/octet-stream',
    );
    res.setHeader('Cache-Control', this.getCacheControl(objectName));
    stream.pipe(res);
  }

  /** 读取缓存控制。 */
  private getCacheControl(objectName: string): string {
    return objectName.endsWith('.json')
      ? 'public, max-age=60'
      : 'public, max-age=31536000, immutable';
  }
}
