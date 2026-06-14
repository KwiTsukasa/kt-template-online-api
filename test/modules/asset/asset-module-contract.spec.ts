jest.mock('../../../src/qqbot/qqbot.module', () => ({
  QqbotModule: class QqbotModule {},
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../../src/app.module';
import { MinioClientController } from '../../../src/minio/minio.controller';
import { MinioClientModule } from '../../../src/minio/minio.module';
import { MinioClientService } from '../../../src/minio/minio.service';
import {
  ASSET_CONTROLLERS,
  ASSET_DOMAIN_CONTRACT,
  ASSET_PROVIDERS,
  AssetModule,
} from '../../../src/modules/asset/asset.module';
import { AdminPlatformConfigModule } from '../../../src/modules/admin/platform-config/admin-platform-config.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

const expectControllersNotRegisteredDirectly = (
  moduleClass: unknown,
  controllers: unknown[],
) => {
  const directControllers = getModuleMetadata(
    moduleClass,
    MODULE_METADATA.CONTROLLERS,
  );

  for (const controller of controllers) {
    expect(directControllers).not.toContain(controller);
  }
};

describe('Asset module contract', () => {
  const schema = readRefactorV3SqlSchema();

  it('keeps MinIO-backed asset routes compatible through the Asset boundary', () => {
    const routes = collectControllerRoutes(ASSET_CONTROLLERS);

    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'GET /minio/check',
        'POST /minio/bucket',
        'POST /minio/upload',
        'GET /minio/list',
        'GET /minio/url',
        'GET /minio/resource-proxy',
        'GET /minio/download',
        'DELETE /minio/remove',
      ]),
    );
  });

  it('routes MinIO through the Asset module boundary without duplicate direct controllers', () => {
    expect(getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([AssetModule]),
    );
    expect(getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS)).not.toEqual(
      expect.arrayContaining([MinioClientModule]),
    );
    expect(
      getModuleMetadata(AdminPlatformConfigModule, MODULE_METADATA.IMPORTS),
    ).toEqual(expect.arrayContaining([AssetModule]));
    expect(
      getModuleMetadata(AdminPlatformConfigModule, MODULE_METADATA.IMPORTS),
    ).not.toEqual(expect.arrayContaining([MinioClientModule]));

    expect(getModuleMetadata(AssetModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([MinioClientModule]),
    );
    expect(getModuleMetadata(AssetModule, MODULE_METADATA.EXPORTS)).toEqual(
      expect.arrayContaining([MinioClientModule]),
    );
    expectControllersNotRegisteredDirectly(AssetModule, ASSET_CONTROLLERS);

    expect(
      getModuleMetadata(MinioClientModule, MODULE_METADATA.CONTROLLERS),
    ).toEqual(expect.arrayContaining([MinioClientController]));
    expect(
      getModuleMetadata(MinioClientModule, MODULE_METADATA.PROVIDERS),
    ).toEqual(expect.arrayContaining([MinioClientService]));
    expect(ASSET_CONTROLLERS).toEqual(
      expect.arrayContaining([MinioClientController]),
    );
    expect(ASSET_PROVIDERS).toEqual(
      expect.arrayContaining([MinioClientService]),
    );
  });

  it('matches the real Batch 3 Asset SQL schema and boundary contract', () => {
    expect(ASSET_DOMAIN_CONTRACT.tables).toEqual([
      'asset_bucket',
      'asset_object',
      'asset_reference',
      'asset_access_grant',
    ]);
    for (const table of ASSET_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }

    schema.expectTableColumns('asset_bucket', [
      'id',
      'bucket_key',
      'bucket_name',
      'provider',
      'status',
    ]);
    schema.expectTableColumns('asset_object', [
      'id',
      'bucket_id',
      'object_key',
      'source_module',
      'mime_type',
      'size_bytes',
      'metadata_json',
    ]);
    schema.expectTableColumns('asset_reference', [
      'id',
      'object_id',
      'owner_module',
      'owner_type',
      'owner_id',
    ]);
    schema.expectTableColumns('asset_access_grant', [
      'id',
      'object_id',
      'grant_token',
      'expires_at',
      'status',
    ]);

    expect(ASSET_DOMAIN_CONTRACT.objectOwnership).toEqual({
      objectTable: 'asset_object',
      bucketTable: 'asset_bucket',
      ownerModuleField: 'source_module',
      objectKeyField: 'object_key',
    });
    expect(ASSET_DOMAIN_CONTRACT.mimeMetadata).toEqual({
      objectTable: 'asset_object',
      mimeField: 'mime_type',
      sizeField: 'size_bytes',
      metadataField: 'metadata_json',
    });
    expect(ASSET_DOMAIN_CONTRACT.reference).toEqual({
      table: 'asset_reference',
      objectKey: 'object_id',
      ownerFields: ['owner_module', 'owner_type', 'owner_id'],
    });
    expect(ASSET_DOMAIN_CONTRACT.accessGrant).toEqual({
      table: 'asset_access_grant',
      objectKey: 'object_id',
      tokenField: 'grant_token',
      expiresAtField: 'expires_at',
      statusField: 'status',
    });
  });
});
