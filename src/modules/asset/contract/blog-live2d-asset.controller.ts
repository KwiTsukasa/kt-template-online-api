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
   * Streams a versioned Pio runtime asset after Origin/Referer validation.
   * @param version - Runtime version segment such as `v1`.
   * @param assetPath - Wildcard asset path under the version, including nested texture or motion folders.
   * @param referer - Browser Referer header used by the hotlink protection policy.
   * @param origin - Browser Origin header used when the request type supplies it.
   * @param res - Express response that receives MinIO content headers and stream bytes.
   * @returns Promise resolved after the stream is attached to the Express response; no Vben body is returned.
   */
  @Get('pio/:version/*assetPath')
  @ApiOperation({ summary: '获取 Pio Live2D 运行时资源' })
  @ApiParam({ name: 'version', example: 'v1' })
  @ApiParam({ name: 'assetPath', example: 'textures/texture_00.png' })
  @ApiFileDownloadResponse('Pio Live2D runtime asset stream')
  @Public()
  async getPioAsset(
    @Param('version') version: string,
    @Param('assetPath') assetPath: BlogLive2DRuntimeAssetPath,
    @Headers('referer') referer: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res() res: Response,
  ) {
    this.blogLive2DAssetService.assertAllowedRequest(referer, origin);
    const { stream, stat, objectName } =
      await this.blogLive2DAssetService.getRuntimeObject(version, assetPath);

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
   * @returns Short cache for manifests and immutable cache for hashed or versioned runtime assets.
   */
  private getCacheControl(objectName: string): string {
    return objectName.endsWith('manifest.json') ||
      objectName.endsWith('.model3.json')
      ? 'public, max-age=60'
      : 'public, max-age=31536000, immutable';
  }
}
