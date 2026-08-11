import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinioService } from 'nestjs-minio-client';
import { MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT } from '@/modules/asset/domain/asset-private-bucket';
import { buildDescriptorObjectKey } from './media-governance-domain';
import { parseTorrentDescriptor } from './media-torrent-descriptor';

export const MEDIA_DESCRIPTOR_PRIVATE_BUCKET =
  MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT;

@Injectable()
export class MediaDescriptorStore {
  constructor(
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

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
}
