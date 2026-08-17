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

  /**
   * 校验请求来源后读取 Live2D 角色目录对象，并写入缓存、长度与内容类型响应头。
   * @param character - 决定角色目录内容、边界或目标的 `character` 值。
   * @param referer - 决定角色目录内容、边界或目标的 `referer` 值。
   * @param origin - 决定角色目录内容、边界或目标的 `origin` 值。
   * @param req - 用于角色目录的当前 HTTP 请求。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   */
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

  /**
   * 校验请求来源后读取指定 Live2D 角色资源，并按对象元数据写入下载响应头。
   * @param character - 决定角色资源内容、边界或目标的 `character` 值。
   * @param family - 决定角色资源内容、边界或目标的 `family` 值。
   * @param assetPath - 必须保持在受控根目录内的资源路径。
   * @param referer - 决定角色资源内容、边界或目标的 `referer` 值。
   * @param origin - 决定角色资源内容、边界或目标的 `origin` 值。
   * @param req - 用于角色资源的当前 HTTP 请求。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   */
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

  /**
   * 按`objectName`读取缓存控制；当 `objectName.endsWith('.json')` 成立时返回 `'public, max-age=60'`。
   * @param objectName - 决定缓存控制内容、边界或目标的 `objectName` 值。
   * @returns 当前状态对应的缓存控制，取值为 `'public, max-age=60'`、`'public, max-age=31536000, immutable'`。
   */
  private getCacheControl(objectName: string): string {
    if (objectName.endsWith('.json')) {
      return 'public, max-age=60';
    }
    return 'public, max-age=31536000, immutable';
  }
}
