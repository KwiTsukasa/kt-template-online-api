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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';

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

  /**
   * 探测指定或默认 MinIO 存储桶是否存在，并将桶名与存在状态写入统一 HTTP 响应。
   * @param res - 用于直接发送统一响应体的 HTTP 响应对象。
   * @param bucketName - 待探测的存储桶名；未提供时由 MinIO 服务选用配置中的默认桶。
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
   * 通过 `minioClientService.ensureBucket` 强制满足前置条件。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param bucketName - 决定Bucket内容、边界或目标的 `bucketName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
   * 根据`res`、`file`、`bucketName`处理上传文件到MinIO；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param file - 决定上传文件到MinIO内容、边界或目标的 `file` 值。
   * @param bucketName - 决定上传文件到MinIO内容、边界或目标的 `bucketName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param objectName - 决定上传文件到MinIO内容、边界或目标的 `objectName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
    url: '/api/minio/download?objectName=uploads%2Fdemo.png&bucketName=kt-template-online',
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
   * 按`res`、`bucketName`、`prefix`读取`list` 对应结果；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param bucketName - 决定`list` 对应结果内容、边界或目标的 `bucketName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param prefix - 决定`list` 对应结果内容、边界或目标的 `prefix` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param recursive - 决定`list` 对应结果内容、边界或目标的 `recursive` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
   * 根据参数 `objectName`，获取文件同源访问地址。
   * @param res - 当前 HTTP 响应；设置 HTTP 状态、响应头或响应体。
   * @param objectName - MinIO 对象键。
   * @param bucketName - 可选的 MinIO Bucket 名称。
   */
  @Get('url')
  @ApiOperation({ summary: '获取文件同源访问地址' })
  @ApiQuery({ name: 'objectName' })
  @ApiQuery({ name: 'bucketName', required: false })
  @ApiSuccessResponse({
    schema: {
      type: 'string',
      description: '文件同源访问地址',
    },
    example:
      '/api/minio/download?objectName=uploads%2Fdemo.png&bucketName=kt-template-online',
  })
  async getUrl(
    @Res() res,
    @Query('objectName') objectName: string,
    @Query('bucketName') bucketName?: string,
  ) {
    const result = this.minioClientService.getSameOriginDownloadUrl(
      objectName,
      bucketName,
    );

    res.send(this.toolsService.res(HttpStatus.OK, '操作成功', result));
  }

  /**
   * 根据参数 `url`，代理截图所需的图片/CSS/字体资源。
   * @param res - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @throws 当 `!response.ok` 成立时拒绝当前输入并抛出 `BadRequestException`；当 `!this.isAllowedProxyResource(contentType, target)` 成立时拒绝当前输入并抛出 `BadRequestException`；
   *   当 `err instanceof BadRequestException` 成立时重新抛出该入口捕获且决定公开的原异常；当 `fetch` 或 `response.headers.get` 调用失败时拒绝当前输入并抛出 `BadRequestException`。
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
   * 读取指定 MinIO 对象，按对象元数据设置 MIME 类型与附件文件名，再将对象流写入 HTTP 响应。
   * @param res - 用于设置下载响应头并接收对象流的 HTTP 响应对象。
   * @param objectName - MinIO 对象键；其路径末段会作为编码后的下载文件名。
   * @param bucketName - 对象所在存储桶；未提供时由 MinIO 服务选用配置中的默认桶。
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
   * 按`res`、`objectName`、`bucketName`移除`remove` 对应结果；向目标通道投递结果（`res.send`）。
   * @param res - 包含 `send` 字段的上游服务响应。
   * @param objectName - 决定`remove` 对应结果内容、边界或目标的 `objectName` 值。
   * @param bucketName - 决定`remove` 对应结果内容、边界或目标的 `bucketName` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
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
   * 解析资源地址并只允许 HTTP 或 HTTPS 协议；地址缺失、格式非法或协议不允许时拒绝请求。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 代理ResourceURL 地址。
   * @throws 当 `!url` 成立时拒绝当前输入并抛出 `BadRequestException`；当 `!['http:', 'https:'].includes(target.protocol)` 成立时拒绝当前输入并抛出 `BadRequestException`；
   *   当 `err instanceof BadRequestException` 成立时重新抛出该入口捕获且决定公开的原异常；当 `includes` 或 `target.toString` 调用失败时拒绝当前输入并抛出 `BadRequestException`。
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
   * 根据`contentType`、`target`与当前约束判定许可范围代理Resource。
   * @param contentType - 决定许可范围代理Resource内容、边界或目标的 `contentType` 值。
   * @param target - 决定许可范围代理Resource内容、边界或目标的 `target` 值。
   * @returns 满足许可范围代理Resource约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
