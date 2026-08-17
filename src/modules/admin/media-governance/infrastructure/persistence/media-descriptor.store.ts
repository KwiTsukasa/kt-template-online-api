import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import { MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT } from '@/modules/asset/domain/asset-private-bucket';
import { buildDescriptorObjectKey } from '../../domain/media-governance-domain';
import { parseTorrentDescriptor } from '../../domain/media-torrent-descriptor';

export const MEDIA_DESCRIPTOR_PRIVATE_BUCKET =
  MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT;

@Injectable()
export class MediaDescriptorStore {
  constructor(
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  /** 解析并校验种子描述符，将原始内容写入私有对象存储后返回密封元数据。 */
  async putTorrentDescriptor(input: {
    bytes: Buffer;
    revision: number;
    sourceId: string;
    taskId: string;
  }) {
    const parsed = parseTorrentDescriptor(input.bytes);
    const bucketName =
      this.configService.get('MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET') ||
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET;
    const objectId = buildDescriptorObjectKey({
      descriptorRevision: input.revision,
      descriptorSha256: parsed.descriptorSha256,
      sourceId: input.sourceId,
      taskId: input.taskId,
      transportKind: 'torrent',
    });
    const client = this.minioService.client;
    if (!(await client.bucketExists(bucketName))) {
      await client.makeBucket(bucketName, 'us-east-1');
    }
    await client.putObject(
      bucketName,
      objectId,
      input.bytes,
      input.bytes.length,
      { 'Content-Type': 'application/x-bittorrent' },
    );
    return {
      bytes: input.bytes.length,
      descriptorSha256: parsed.descriptorSha256,
      infoHash: parsed.infoHash,
      manifest: parsed.manifest,
      manifestSha256: parsed.manifestSha256,
      objectId,
    };
  }

  /** 校验磁力链接描述符并写入私有对象存储，返回可持久化的摘要引用。 */
  async putMagnetDescriptor(input: {
    magnetUri: string;
    revision: number;
    sourceId: string;
    taskId: string;
  }) {
    const bytes = Buffer.from(input.magnetUri, 'utf8');
    if (bytes.length === 0 || bytes.length > 16 * 1024) {
      throw new Error('magnet-descriptor-size-invalid');
    }
    const descriptorSha256 = createHash('sha256').update(bytes).digest('hex');
    const bucketName =
      this.configService.get('MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET') ||
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET;
    const objectId = buildDescriptorObjectKey({
      descriptorRevision: input.revision,
      descriptorSha256,
      sourceId: input.sourceId,
      taskId: input.taskId,
      transportKind: 'magnet',
    });
    const client = this.minioService.client;
    if (!(await client.bucketExists(bucketName))) {
      await client.makeBucket(bucketName, 'us-east-1');
    }
    await client.putObject(bucketName, objectId, bytes, bytes.length, {
      'Content-Type': 'text/x-uri',
    });
    return { bytes: bytes.length, descriptorSha256, objectId };
  }

  /** 从私有对象存储读取有界描述符，并校验对象键与内容摘要。 */
  async readDescriptor(input: {
    descriptorSha256: string;
    objectId: string;
  }): Promise<Buffer> {
    if (
      !/^tasks\/[A-Za-z0-9._-]{8,96}\/sources\/[A-Za-z0-9._-]{8,96}\/revisions\/\d+-[a-f0-9]{64}\.(?:magnet|torrent)$/.test(
        input.objectId,
      )
    ) {
      throw new Error('descriptor-object-id-invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(input.descriptorSha256)) {
      throw new Error('descriptor-sha256-invalid');
    }
    const bucketName =
      this.configService.get('MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET') ||
      MEDIA_DESCRIPTOR_PRIVATE_BUCKET;
    const stream = await this.minioService.client.getObject(
      bucketName,
      input.objectId,
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      let value: Buffer;
      if (Buffer.isBuffer(chunk)) {
        value = chunk;
      } else {
        value = Buffer.from(chunk);
      }
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) {
        stream.destroy();
        throw new Error('descriptor-size-invalid');
      }
      chunks.push(value);
    }
    if (bytes === 0) throw new Error('descriptor-size-invalid');
    const result = Buffer.concat(chunks, bytes);
    if (
      createHash('sha256').update(result).digest('hex') !==
      input.descriptorSha256
    ) {
      throw new Error('descriptor-sha256-mismatch');
    }
    return result;
  }
}
