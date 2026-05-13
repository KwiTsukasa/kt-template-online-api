import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import type { Readable } from 'stream';

export type MinioUploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type UploadObjectOptions = {
  bucketName?: string;
  objectName?: string;
  file: MinioUploadFile;
};

type ListObjectOptions = {
  bucketName?: string;
  prefix?: string;
  recursive?: boolean;
};

type MinioObjectResult = {
  stream: Readable;
  stat: {
    size: number;
    etag: string;
    lastModified: Date;
    metaData: Record<string, any>;
    versionId?: string | null;
  };
  bucketName: string;
  objectName: string;
};

@Injectable()
export class MinioClientService {
  constructor(
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  private get client() {
    return this.minioService.client;
  }

  getDefaultBucket(): string {
    return this.configService.get('MINIO_BUCKET') || 'kt-template-online';
  }

  getBucketName(bucketName?: string): string {
    return bucketName || this.getDefaultBucket();
  }

  async checkConnection(bucketName?: string) {
    const targetBucket = this.getBucketName(bucketName);
    const exists = await this.client.bucketExists(targetBucket);

    return {
      bucketName: targetBucket,
      exists,
    };
  }

  async ensureBucket(bucketName?: string): Promise<string> {
    const targetBucket = this.getBucketName(bucketName);
    const exists = await this.client.bucketExists(targetBucket);

    if (!exists) {
      await this.client.makeBucket(targetBucket, 'us-east-1');
    }

    return targetBucket;
  }

  async uploadObject({ bucketName, objectName, file }: UploadObjectOptions) {
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

  async listObjects({
    bucketName,
    prefix = '',
    recursive = true,
  }: ListObjectOptions) {
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

  private createObjectName(originalName: string): string {
    // 前端未指定对象名时，生成带时间和随机段的路径，降低同名文件覆盖概率。
    const safeName = originalName.replace(/[\\/]/g, '_');
    const random = Math.random().toString(36).slice(2, 8);

    return `uploads/${Date.now()}-${random}-${safeName}`;
  }
}
