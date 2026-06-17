import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import type {
  MinioListObjectOptions,
  MinioObjectResult,
  MinioUploadObjectOptions,
} from '../domain/asset-minio.types';

@Injectable()
export class MinioClientService {
  /**
   * 初始化 MinioClientService 实例。
   * @param minioService - minioService 服务依赖；影响 constructor 的返回值。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 执行 MinIO 资源流程。
   */
  private get client() {
    return this.minioService.client;
  }

  /**
   * 查询 MinIO 资源数据。
   * @returns MinIO 资源查询结果。
   */
  getDefaultBucket(): string {
    return this.configService.get('MINIO_BUCKET') || 'kt-template-online';
  }

  /**
   * 查询 MinIO 资源数据。
   * @param bucketName - bucketName 输入；限定 MinIO查询范围。
   * @returns MinIO 资源查询结果。
   */
  getBucketName(bucketName?: string): string {
    return bucketName || this.getDefaultBucket();
  }

  /**
   * 执行 MinIO 资源流程。
   * @param bucketName - bucketName 输入；驱动 `this.getBucketName()` 的 MinIO步骤。
   */
  async checkConnection(bucketName?: string) {
    const targetBucket = this.getBucketName(bucketName);
    const exists = await this.client.bucketExists(targetBucket);

    return {
      bucketName: targetBucket,
      exists,
    };
  }

  /**
   * 确保Bucket。
   * @param bucketName - bucketName 输入；驱动 `this.getBucketName()` 的 MinIO步骤。
   * @returns MinIO 资源渲染后的图片、画布或文本。
   */
  async ensureBucket(bucketName?: string): Promise<string> {
    const targetBucket = this.getBucketName(bucketName);
    const exists = await this.client.bucketExists(targetBucket);

    if (!exists) {
      await this.client.makeBucket(targetBucket, 'us-east-1');
    }

    return targetBucket;
  }

  /**
   * 执行 MinIO 资源流程。
   * @param { bucketName, objectName, file, } - 上传对象选项；`bucketName` 覆盖默认 bucket，`objectName` 指定 MinIO 对象键，`file` 是 Multer 上传文件载荷。
   */
  async uploadObject({
    bucketName,
    objectName,
    file,
  }: MinioUploadObjectOptions) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    const targetBucket = await this.ensureBucket(bucketName);
    const targetObjectName =
      objectName || this.createObjectName(file.originalname);

    const result = await this.client.putObject(
      targetBucket,
      targetObjectName,
      file.buffer,
      file.size,
      {
        'Content-Type': file.mimetype,
      },
    );

    return {
      bucketName: targetBucket,
      objectName: targetObjectName,
      etag: result.etag,
      size: file.size,
      mimeType: file.mimetype,
      url: await this.getPresignedUrl(targetObjectName, targetBucket),
    };
  }

  /**
   * 列出Objects。
   * @param { bucketName, prefix = '', recursive = true, } - 对象列表选项；`bucketName` 定位 bucket，`prefix` 限定对象键前缀，`recursive` 控制是否递归列出。
   */
  async listObjects({
    bucketName,
    prefix = '',
    recursive = true,
  }: MinioListObjectOptions) {
    const targetBucket = this.getBucketName(bucketName);
    const exists = await this.client.bucketExists(targetBucket);

    if (!exists) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const objects = [];
      const stream = this.client.listObjectsV2(targetBucket, prefix, recursive);

      stream.on('data', (object) => objects.push(object));
      stream.on('error', reject);
      stream.on('end', () => resolve(objects));
    });
  }

  /**
   * 查询 MinIO 资源数据。
   * @param objectName - objectName 输入；驱动 `BadRequestException()`、`client.statObject()`、`client.getObject()` 的 MinIO步骤。
   * @param bucketName - bucketName 输入；驱动 `this.getBucketName()` 的 MinIO步骤。
   * @returns MinIO 资源查询结果。
   */
  async getObject(
    objectName: string,
    bucketName?: string,
  ): Promise<MinioObjectResult> {
    if (!objectName) {
      throw new BadRequestException('objectName不能为空');
    }

    const targetBucket = this.getBucketName(bucketName);
    const objectStat = await this.client.statObject(targetBucket, objectName);
    const stream = await this.client.getObject(targetBucket, objectName);

    return {
      stream,
      stat: objectStat,
      bucketName: targetBucket,
      objectName,
    };
  }

  /**
   * 查询 MinIO 资源数据。
   * @param objectName - objectName 输入；驱动 `BadRequestException()`、`client.presignedGetObject()` 的 MinIO步骤。
   * @param bucketName - bucketName 输入；驱动 `client.presignedGetObject()` 的 MinIO步骤。
   * @param expiry - expiry 输入；驱动 `client.presignedGetObject()` 的 MinIO步骤。
   * @returns MinIO 资源查询结果。
   */
  async getPresignedUrl(
    objectName: string,
    bucketName?: string,
    expiry = 24 * 60 * 60,
  ): Promise<string> {
    if (!objectName) {
      throw new BadRequestException('objectName不能为空');
    }

    return this.client.presignedGetObject(
      this.getBucketName(bucketName),
      objectName,
      expiry,
    );
  }

  /**
   * 清理 MinIO 资源状态。
   * @param objectName - objectName 输入；驱动 `BadRequestException()`、`client.removeObject()` 的 MinIO步骤。
   * @param bucketName - bucketName 输入；驱动 `client.removeObject()` 的 MinIO步骤。
   * @returns MinIO 资源清理后的状态。
   */
  async removeObject(
    objectName: string,
    bucketName?: string,
  ): Promise<boolean> {
    if (!objectName) {
      throw new BadRequestException('objectName不能为空');
    }

    await this.client.removeObject(this.getBucketName(bucketName), objectName);
    return true;
  }

  /**
   * 创建 MinIO 资源对象或配置。
   * @param originalName - originalName 输入；生成规范化文本。
   * @returns 创建后的 MinIO 资源对象或配置。
   */
  private createObjectName(originalName: string): string {
    // 前端未指定对象名时，生成带时间和随机段的路径，降低同名文件覆盖概率。
    const safeName = originalName.replace(/[\\/]/g, '_');
    const random = Math.random().toString(36).slice(2, 8);

    return `uploads/${Date.now()}-${random}-${safeName}`;
  }
}
