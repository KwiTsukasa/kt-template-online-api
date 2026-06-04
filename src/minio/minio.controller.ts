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
import { MinioClientService } from './minio.service';
import type { MinioUploadFile } from './minio.types';
import {
  ApiFileDownloadResponse,
  ApiArrayResponse,
  ApiModelResponse,
  ApiSuccessResponse,
  ToolsService,
} from '@/common';
import {
  MinioBucketStatusDto,
  MinioObjectDto,
  MinioUploadResultDto,
} from './minio.dto';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';

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
  constructor(
    private readonly toolsService: ToolsService,
    private readonly minioClientService: MinioClientService,
  ) {}

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
      lastModified: '2026-05-13T02:30:00.000Z',
    },
  ])
  async list(
    @Res() res,
    @Query('bucketName') bucketName?: string,
    @Query('prefix') prefix?: string,
    @Query('recursive') recursive?: string,
  ) {
    const result = await this.minioClientService.listObjects({
      bucketName,
      prefix,
      recursive: recursive !== 'false',
    });

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

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

  private isAllowedProxyResource(contentType: string, target: string) {
    const normalizedType = contentType.split(';')[0].trim().toLowerCase();

    return (
      PROXY_RESOURCE_CONTENT_TYPES.some((type) =>
        normalizedType.startsWith(type),
      ) || PROXY_RESOURCE_EXTENSION_RE.test(target)
    );
  }
}
