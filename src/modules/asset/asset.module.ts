import { Module } from '@nestjs/common';
import { MinioClientController } from '@/minio/minio.controller';
import { MinioClientModule } from '@/minio/minio.module';
import { MinioClientService } from '@/minio/minio.service';

export const ASSET_CONTROLLERS = [MinioClientController];

export const ASSET_PROVIDERS = [MinioClientService];

export const ASSET_DOMAIN_CONTRACT = {
  tables: [
    'asset_bucket',
    'asset_object',
    'asset_reference',
    'asset_access_grant',
  ],
  objectOwnership: {
    objectTable: 'asset_object',
    bucketTable: 'asset_bucket',
    ownerModuleField: 'source_module',
    objectKeyField: 'object_key',
  },
  mimeMetadata: {
    objectTable: 'asset_object',
    mimeField: 'mime_type',
    sizeField: 'size_bytes',
    metadataField: 'metadata_json',
  },
  reference: {
    table: 'asset_reference',
    objectKey: 'object_id',
    ownerFields: ['owner_module', 'owner_type', 'owner_id'],
  },
  accessGrant: {
    table: 'asset_access_grant',
    objectKey: 'object_id',
    tokenField: 'grant_token',
    expiresAtField: 'expires_at',
    statusField: 'status',
  },
} as const;

@Module({
  imports: [MinioClientModule],
  exports: [MinioClientModule],
})
export class AssetModule {}
