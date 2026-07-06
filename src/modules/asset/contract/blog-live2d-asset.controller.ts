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
   * Streams a public Blog Live2D character root catalog after Origin/Referer validation.
   * @param character - Public character segment, currently `pio` or `tia`.
   * @param referer - Browser Referer header used by the hotlink protection policy.
   * @param origin - Browser Origin header used when the request type supplies it.
   * @param res - Express response that receives MinIO content headers and stream bytes.
   * @returns Promise resolved after the stream is attached to the Express response; no Vben body is returned.
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
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(referer, origin);
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
   * Streams a fixed-family Blog Live2D runtime asset after Origin/Referer validation.
   * @param character - Public character segment, currently `pio` or `tia`.
   * @param family - Runtime family segment, either `moc` for WordPress Cubism2 parity or `moc3` for reconstructed Cubism3 assets.
   * @param assetPath - Wildcard asset path under the family, including nested texture or motion folders.
   * @param referer - Browser Referer header used by the hotlink protection policy.
   * @param origin - Browser Origin header used when the request type supplies it.
   * @param res - Express response that receives MinIO content headers and stream bytes.
   * @returns Promise resolved after the stream is attached to the Express response; no Vben body is returned.
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
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(referer, origin);
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
