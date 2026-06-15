import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthGuardModule } from '@/modules/admin/identity/auth/admin-auth-guard.module';
import { MinioClientService } from './application/asset-minio.service';
import { MinioClientController } from './contract/asset-minio.controller';

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
  imports: [AdminAuthGuardModule, ConfigModule],
  controllers: ASSET_CONTROLLERS,
  providers: ASSET_PROVIDERS,
  exports: ASSET_PROVIDERS,
})
export class AssetModule {}
