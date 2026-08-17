import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import type {
  MinioListObjectOptions,
  MinioObjectResult,
  MinioUploadObjectOptions,
} from '../domain/asset-minio.types';
import { assertGenericAssetBucket } from '../domain/asset-private-bucket';

@Injectable()
export class MinioClientService {
  constructor(
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 暴露 Nest MinIO 服务持有的原生客户端，供本服务执行存储桶和对象操作。
   * @returns 返回当前已配置的 MinIO 客户端实例。
   */
  private get client() {
    return this.minioService.client;
  }

  /**
   * 从运行配置读取通用资源存储桶名称，配置为空时使用应用默认桶。
   * @returns 返回 `this.configService.get('MINIO_BUCKET')` 的可用值；为空时回退到 `'kt-template-online'`。
   */
  getDefaultBucket(): string {
    return this.configService.get('MINIO_BUCKET') || 'kt-template-online';
  }

  /**
   * 选择调用方指定或默认的通用资源桶，并拒绝把媒体治理私有桶用于公开资源接口。
   * @param bucketName - 可选存储桶名称；空值时回退到应用默认桶。
   * @returns 返回通过通用资源桶边界校验的有效存储桶名称。
   */
  getBucketName(bucketName?: string): string {
    return assertGenericAssetBucket(
      bucketName || this.getDefaultBucket(),
      this.configService.get('MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET'),
    );
  }

  /**
   * 根据目标存储桶执行 MinIO 存在性检查，不会自动创建存储桶。
   * @param bucketName - 可选存储桶名称；空值时检查应用默认桶。
   * @returns 返回实际检查的存储桶名称及其存在状态。
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
   * 确保指定或默认的通用资源桶存在；缺失时以 `us-east-1` 区域创建。
   * @param bucketName - 可选存储桶名称；空值时使用应用默认桶。
   * @returns 返回已确认存在的实际存储桶名称。
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
   * 将上传文件写入指定或默认 MinIO 存储桶；对象键缺失时按原文件名生成，并返回同源下载地址。
   * @returns 返回实际存储桶、对象键、ETag、大小、MIME 类型及同源下载地址。
   * @throws 当未提供上传文件时抛出 `BadRequestException`。
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
      url: this.getSameOriginDownloadUrl(targetObjectName, targetBucket),
    };
  }

  /**
   * 按对象键前缀列出指定或默认存储桶中的对象；存储桶不存在时直接返回空数组。
   * @returns 返回收集完成的 MinIO 对象列表；对象流读取失败时拒绝 Promise。
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
   * 从指定或默认存储桶读取对象流，并在同一结果中携带对象统计信息和实际定位信息。
   * @param objectName - 必填的 MinIO 对象键。
   * @param bucketName - 可选存储桶名称；空值时使用应用默认桶。
   * @returns 返回对象流、统计信息、实际存储桶名称和对象键。
   * @throws 当对象键为空时抛出 `BadRequestException`。
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
   * 从指定或默认存储桶读取对象的 MinIO 统计信息，不下载对象内容。
   * @param objectName - 必填的 MinIO 对象键。
   * @param bucketName - 可选存储桶名称；空值时使用应用默认桶。
   * @returns 返回 MinIO 提供的对象统计信息。
   * @throws 当对象键为空时抛出 `BadRequestException`。
   */
  async statObject(
    objectName: string,
    bucketName?: string,
  ): Promise<MinioObjectResult['stat']> {
    if (!objectName) {
      throw new BadRequestException('objectName不能为空');
    }

    return this.client.statObject(this.getBucketName(bucketName), objectName);
  }

  /**
   * 将对象定位信息编码到同源下载接口地址，避免向客户端暴露 MinIO 服务地址。
   * @param objectName - 必填的 MinIO 对象键。
   * @param bucketName - 可选存储桶名称；提供时一并写入查询参数。
   * @returns 返回同源 `/api/minio/download` 地址及编码后的对象查询参数。
   * @throws 当对象键为空时抛出 `BadRequestException`。
   */
  getSameOriginDownloadUrl(objectName: string, bucketName?: string): string {
    if (!objectName) {
      throw new BadRequestException('objectName不能为空');
    }

    const searchParams = new URLSearchParams({ objectName });
    if (bucketName) {
      searchParams.set('bucketName', bucketName);
    }

    return `/api/minio/download?${searchParams.toString()}`;
  }

  /**
   * 从指定或默认存储桶删除对象，并仅在 MinIO 删除操作完成后报告成功。
   * @param objectName - 必填的 MinIO 对象键。
   * @param bucketName - 可选存储桶名称；空值时使用应用默认桶。
   * @returns MinIO 删除完成后固定返回 `true`。
   * @throws 当对象键为空时抛出 `BadRequestException`。
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
   * 将原文件名中的路径分隔符替换为下划线，并加入时间戳和随机段以降低同名覆盖风险。
   * @param originalName - 上传文件的原始名称，可能包含路径分隔符。
   * @returns 返回位于 `uploads/` 前缀下的安全对象键。
   */
  private createObjectName(originalName: string): string {
    // 前端未指定对象名时，生成带时间和随机段的路径，降低同名文件覆盖概率。
    const safeName = originalName.replace(/[\\/]/g, '_');
    const random = Math.random().toString(36).slice(2, 8);

    return `uploads/${Date.now()}-${random}-${safeName}`;
  }
}
