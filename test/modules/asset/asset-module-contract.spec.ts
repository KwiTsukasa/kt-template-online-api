jest.mock('../../../src/modules/qqbot/core/qqbot-core.module', () => ({
  QqbotCoreModule: class QqbotCoreModule {},
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../../../src/common';
import { AppModule } from '../../../src/app.module';
import { AdminAuthGuardModule } from '../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import {
  ASSET_CONTROLLERS,
  ASSET_DOMAIN_CONTRACT,
  ASSET_PROVIDERS,
  AssetModule,
} from '../../../src/modules/asset/asset.module';
import { MinioClientService } from '../../../src/modules/asset/application/asset-minio.service';
import { BlogLive2DAssetService } from '../../../src/modules/asset/application/blog-live2d-asset.service';
import { BlogLive2DAssetController } from '../../../src/modules/asset/contract/blog-live2d-asset.controller';
import { MinioClientController } from '../../../src/modules/asset/contract/asset-minio.controller';
import { AdminPlatformConfigModule } from '../../../src/modules/admin/platform-config/admin-platform-config.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../helpers/sql-schema.helper';

/**
 * 查询 MinIO 资源数据。
 * @param moduleClass - Nest 模块类；读取装饰器 metadata。
 * @param key - 键名；读取装饰器 metadata。
 * @returns MinIO 资源查询结果。
 */
const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

/**
 * 执行 MinIO 资源流程。
 * @param modules - 模块列表；计算 MinIO布尔判断。
 * @param moduleName - 模块名称文本；构造测试断言。
 */
const expectNoModuleNamed = (modules: unknown[], moduleName: string) => {
  expect(
    modules.some(
      (moduleRef) =>
        typeof moduleRef === 'function' && moduleRef.name === moduleName,
    ),
  ).toBe(false);
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
        'GET /blog/live2d/pio/catalog.json',
        'GET /blog/live2d/pio/:family/*assetPath',
      ]),
    );
  });

  it('routes MinIO through the Asset module boundary without duplicate direct controllers', () => {
    expect(getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([AssetModule]),
    );
    expect(
      getModuleMetadata(AdminPlatformConfigModule, MODULE_METADATA.IMPORTS),
    ).toEqual(expect.arrayContaining([AssetModule]));

    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);
    const platformImports = getModuleMetadata(
      AdminPlatformConfigModule,
      MODULE_METADATA.IMPORTS,
    );
    const assetImports = getModuleMetadata(
      AssetModule,
      MODULE_METADATA.IMPORTS,
    );
    const assetExports = getModuleMetadata(
      AssetModule,
      MODULE_METADATA.EXPORTS,
    );

    expectNoModuleNamed(appImports, 'MinioClientModule');
    expectNoModuleNamed(platformImports, 'MinioClientModule');
    expectNoModuleNamed(assetImports, 'MinioClientModule');
    expectNoModuleNamed(assetExports, 'MinioClientModule');

    expect(assetImports).toEqual(
      expect.arrayContaining([AdminAuthGuardModule, ConfigModule]),
    );

    expect(getModuleMetadata(AssetModule, MODULE_METADATA.CONTROLLERS)).toEqual(
      expect.arrayContaining([
        MinioClientController,
        BlogLive2DAssetController,
      ]),
    );
    expect(getModuleMetadata(AssetModule, MODULE_METADATA.PROVIDERS)).toEqual(
      expect.arrayContaining([MinioClientService, BlogLive2DAssetService]),
    );
    expect(assetExports).toEqual(
      expect.arrayContaining([MinioClientService, BlogLive2DAssetService]),
    );
    expect(ASSET_CONTROLLERS).toEqual(
      expect.arrayContaining([
        MinioClientController,
        BlogLive2DAssetController,
      ]),
    );
    expect(ASSET_PROVIDERS).toEqual(
      expect.arrayContaining([MinioClientService, BlogLive2DAssetService]),
    );
  });

  it('marks the Blog Live2D runtime stream as an explicit public asset route', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogLive2DAssetController.prototype.getPioCatalog,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BlogLive2DAssetController.prototype.getPioAsset,
      ),
    ).toBe(true);
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
