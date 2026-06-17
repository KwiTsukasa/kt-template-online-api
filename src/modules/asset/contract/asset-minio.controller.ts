import {
  BadRequestException,
  Controller,
  Body,
  Delete,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { MinioClientService } from '../application/asset-minio.service';
import type { MinioUploadFile } from '../domain/asset-minio.types';
import {
  ApiFileDownloadResponse,
  ApiArrayResponse,
  ApiModelResponse,
  ApiSuccessResponse,
  transformKtDateTimeFields,
  ToolsService,
} from '@/common';
import {
  MinioBucketStatusDto,
  MinioObjectDto,
  MinioUploadResultDto,
} from './asset-minio.dto';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';

const PROXY_RESOURCE_TIMEOUT = 1000 * 15;
const PROXY_RESOURCE_CONTENT_TYPES = [
  'image/',
  'font/',
  'text/css',
  'application/font',
  'application/x-font',
  'application/vnd.ms-fontobject',
];
const PROXY_RESOURCE_EXTENSION_RE =
  /\.(avif|bmp|css|eot|gif|ico|jpe?g|otf|png|svg|ttf|webp|woff2?)(?:[?#].*)?$/i;

@Controller('minio')
@ApiTags('基础能力 - MinIO')
@UseGuards(JwtAuthGuard)
export class MinioClientController {
  /**
   * 初始化 MinioClientController 实例。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param minioClientService - minioClientService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly toolsService: ToolsService,
    private readonly minioClientService: MinioClientService,
  ) {}

  /**
   * 检查MinIO连接和Bucket状态。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param bucketName - bucketName 输入；驱动 `minioClientService.checkConnection()` 的 MinIO步骤。
   */
  @Get('check')
  @ApiOperation({ summary: '检查MinIO连接和Bucket状态' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiModelResponse(MinioBucketStatusDto, {
    bucketName: 'kt-template-online',
    exists: true,
  })
  async check(@Res() res, @Query('bucketName') bucketName?: string) {
    const result = await this.minioClientService.checkConnection(bucketName);

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 创建 MinIO 资源对象或配置。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param bucketName - bucketName 输入；驱动 `minioClientService.ensureBucket()` 的 MinIO步骤。
   */
  @Post('bucket')
  @ApiOperation({ summary: '创建Bucket（存在则跳过）' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiSuccessResponse({
    schema: {
      type: 'string',
      description: 'Bucket名称',
    },
    example: 'kt-template-online',
  })
  async createBucket(@Res() res, @Query('bucketName') bucketName?: string) {
    const result = await this.minioClientService.ensureBucket(bucketName);

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 上传文件到MinIO。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param file - file 输入；影响 upload 的返回值。
   * @param bucketName - bucketName 输入；影响 upload 的返回值。
   * @param objectName - objectName 输入；影响 upload 的返回值。
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传文件到MinIO' })
  @ApiConsumes('multipart/form-data')
  @ApiModelResponse(MinioUploadResultDto, {
    bucketName: 'kt-template-online',
    objectName: 'uploads/1715580000000-a1b2c3-demo.png',
    etag: '9b2cf535f27731c974343645a3985328',
    size: 2048,
    mimeType: 'image/png',
    url: 'http://127.0.0.1:9000/kt-template-online/uploads/demo.png',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        bucketName: {
          type: 'string',
        },
        objectName: {
          type: 'string',
        },
      },
      required: ['file'],
    },
  })
  async upload(
    @Res() res,
    @UploadedFile() file: MinioUploadFile,
    @Body('bucketName') bucketName?: string,
    @Body('objectName') objectName?: string,
  ) {
    const result = await this.minioClientService.uploadObject({
      bucketName,
      objectName,
      file,
    });

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 查询 MinIO 资源数据。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param bucketName - bucketName 输入；限定 MinIO查询范围。
   * @param prefix - prefix 输入；限定 MinIO查询范围。
   * @param recursive - recursive 输入；限定 MinIO查询范围。
   */
  @Get('list')
  @ApiOperation({ summary: '获取MinIO文件列表' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiQuery({ name: 'prefix', required: false })
  @ApiQuery({ name: 'recursive', required: false })
  @ApiArrayResponse(MinioObjectDto, [
    {
      name: 'uploads/demo.png',
      size: 2048,
      etag: '9b2cf535f27731c974343645a3985328',
      lastModified: '2026-05-13 10:30:00',
    },
  ])
  async list(
    @Res() res,
    @Query('bucketName') bucketName?: string,
    @Query('prefix') prefix?: string,
    @Query('recursive') recursive?: string,
  ) {
    const result = (
      (await this.minioClientService.listObjects({
        bucketName,
        prefix,
        recursive: recursive !== 'false',
      })) as Record<string, unknown>[]
    ).map((item) =>
      transformKtDateTimeFields(Object.assign(new MinioObjectDto(), item)),
    );

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 获取文件临时访问地址。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param objectName - objectName 输入；驱动 `minioClientService.getPresignedUrl()` 的 MinIO步骤。
   * @param bucketName - bucketName 输入；驱动 `minioClientService.getPresignedUrl()` 的 MinIO步骤。
   * @param expiry - expiry 输入；驱动 `minioClientService.getPresignedUrl()` 的 MinIO步骤。
   */
  @Get('url')
  @ApiOperation({ summary: '获取文件临时访问地址' })
  @ApiQuery({ name: 'objectName' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiQuery({ name: 'expiry', required: false })
  @ApiSuccessResponse({
    schema: {
      type: 'string',
      description: '文件临时访问地址',
    },
    example:
      'http://127.0.0.1:9000/kt-template-online/uploads/demo.png?X-Amz-Algorithm=AWS4-HMAC-SHA256',
  })
  async getUrl(
    @Res() res,
    @Query('objectName') objectName: string,
    @Query('bucketName') bucketName?: string,
    @Query('expiry') expiry?: string,
  ) {
    const result = await this.minioClientService.getPresignedUrl(
      objectName,
      bucketName,
      expiry ? Number(expiry) : undefined,
    );

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 代理截图所需的图片/CSS/字体资源。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param url - 访问地址；驱动 `this.getProxyResourceUrl()` 的 MinIO步骤。
   */
  @Get('resource-proxy')
  @ApiOperation({ summary: '代理截图所需的图片/CSS/字体资源' })
  @ApiQuery({ name: 'url' })
  async proxyResource(@Res() res: Response, @Query('url') url: string) {
    const target = this.getProxyResourceUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_RESOURCE_TIMEOUT);

    try {
      const response = await fetch(target, {
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadRequestException(`资源代理失败：${response.status}`);
      }

      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';

      if (!this.isAllowedProxyResource(contentType, target)) {
        throw new BadRequestException('仅支持代理图片、CSS 和字体资源');
      }

      const data = Buffer.from(await response.arrayBuffer());

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(data);
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }

      throw new BadRequestException('资源代理失败');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 下载MinIO文件。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param objectName - objectName 输入；生成规范化文本。
   * @param bucketName - bucketName 输入；驱动 `minioClientService.getObject()` 的 MinIO步骤。
   */
  @Get('download')
  @ApiOperation({ summary: '下载MinIO文件' })
  @ApiQuery({ name: 'objectName' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiFileDownloadResponse()
  async download(
    @Res() res: Response,
    @Query('objectName') objectName: string,
    @Query('bucketName') bucketName?: string,
  ) {
    const { stream, stat } = await this.minioClientService.getObject(
      objectName,
      bucketName,
    );

    res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] || 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(
        objectName.split('/').pop(),
      )}"`,
    );

    stream.pipe(res);
  }

  /**
   * 删除MinIO文件。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param objectName - objectName 输入；驱动 `minioClientService.removeObject()` 的 MinIO步骤。
   * @param bucketName - bucketName 输入；驱动 `minioClientService.removeObject()` 的 MinIO步骤。
   */
  @Delete('remove')
  @ApiOperation({ summary: '删除MinIO文件' })
  @ApiQuery({ name: 'objectName' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiSuccessResponse({
    schema: {
      type: 'boolean',
    },
    example: true,
  })
  async remove(
    @Res() res,
    @Query('objectName') objectName: string,
    @Query('bucketName') bucketName?: string,
  ) {
    const result = await this.minioClientService.removeObject(
      objectName,
      bucketName,
    );

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 查询 MinIO 资源数据。
   * @param url - 访问地址；驱动 `URL()` 的 MinIO步骤。
   */
  private getProxyResourceUrl(url: string) {
    if (!url) {
      throw new BadRequestException('资源地址不能为空');
    }

    try {
      const target = new URL(url);

      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new BadRequestException('仅支持 http/https 资源');
      }

      return target.toString();
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }

      throw new BadRequestException('资源地址不合法');
    }
  }

  /**
   * 判断 MinIO 资源条件。
   * @param contentType - contentType 输入；生成规范化文本。
   * @param target - target 输入；计算 MinIO判断结果。
   */
  private isAllowedProxyResource(contentType: string, target: string) {
    const normalizedType = contentType.split(';')[0].trim().toLowerCase();

    return (
      PROXY_RESOURCE_CONTENT_TYPES.some((type) =>
        normalizedType.startsWith(type),
      ) || PROXY_RESOURCE_EXTENSION_RE.test(target)
    );
  }
}
