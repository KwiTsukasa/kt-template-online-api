import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiFileDownloadResponse, Public } from '@/common';
import { BlogLive2DAssetService } from '../application/blog-live2d-asset.service';
import type { BlogLive2DRuntimeAssetPath } from '../domain/blog-live2d-asset.types';

@Controller('blog/live2d')
@ApiTags('Blog - Live2D')
export class BlogLive2DAssetController {
  /**
   * Creates the public Blog Live2D asset controller.
   * @param blogLive2DAssetService - Service that validates browser source headers and streams MinIO objects.
   */
  constructor(private readonly blogLive2DAssetService: BlogLive2DAssetService) {}

  /**
   * Streams the public Pio root catalog after Origin/Referer validation.
   * @param referer - Browser Referer header used by the hotlink protection policy.
   * @param origin - Browser Origin header used when the request type supplies it.
   * @param res - Express response that receives MinIO content headers and stream bytes.
   * @returns Promise resolved after the stream is attached to the Express response; no Vben body is returned.
   */
  @Get('pio/catalog.json')
  @ApiOperation({ summary: '获取 Pio Live2D 目录规范索引' })
  @ApiFileDownloadResponse('Pio Live2D root catalog stream')
  @Public()
  async getPioCatalog(
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(referer, origin);
    const { stream, stat, objectName } =
      await this.blogLive2DAssetService.getCatalogObject();

    res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] || 'application/json',
    );
    res.setHeader('Cache-Control', this.getCacheControl(objectName));
    stream.pipe(res);
  }

  /**
   * Streams a fixed-family Pio runtime asset after Origin/Referer validation.
   * @param family - Runtime family segment, either `moc` for WordPress Cubism2 parity or `moc3` for reconstructed Cubism3 assets.
   * @param assetPath - Wildcard asset path under the family, including nested texture or motion folders.
   * @param referer - Browser Referer header used by the hotlink protection policy.
   * @param origin - Browser Origin header used when the request type supplies it.
   * @param res - Express response that receives MinIO content headers and stream bytes.
   * @returns Promise resolved after the stream is attached to the Express response; no Vben body is returned.
   */
  @Get('pio/:family/*assetPath')
  @ApiOperation({ summary: '获取 Pio Live2D 运行时资源' })
  @ApiParam({ name: 'family', example: 'moc' })
  @ApiParam({ name: 'assetPath', example: 'textures/default-costume.png' })
  @ApiFileDownloadResponse('Pio Live2D runtime asset stream')
  @Public()
  async getPioAsset(
    @Param('family') family: string,
    @Param('assetPath') assetPath: BlogLive2DRuntimeAssetPath,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(referer, origin);
    const { stream, stat, objectName } =
      await this.blogLive2DAssetService.getRuntimeObject(family, assetPath);

    res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] || 'application/octet-stream',
    );
    res.setHeader('Cache-Control', this.getCacheControl(objectName));
    stream.pipe(res);
  }

  /**
   * Chooses browser cache policy based on the streamed Live2D object name.
   * @param objectName - MinIO object key returned by the asset service.
   * @returns Short cache for mutable JSON entries and immutable cache for binary model, motion, and texture files.
   */
  private getCacheControl(objectName: string): string {
    return objectName.endsWith('.json')
      ? 'public, max-age=60'
      : 'public, max-age=31536000, immutable';
  }
}
