import { MODULE_METADATA } from '@nestjs/common/constants';
import { DictController } from '../../../src/modules/admin/platform-config/dict/dict.controller';
import { DictModule } from '../../../src/modules/admin/platform-config/dict/dict.module';
import { AdminNoticeController } from '../../../src/modules/admin/platform-config/notice/admin-notice.controller';
import { NoticeModule } from '../../../src/modules/admin/platform-config/notice/notice.module';
import { AdminModule } from '../../../src/modules/admin/admin.module';
import {
  ADMIN_IDENTITY_CONTROLLERS,
  AdminIdentityModule,
} from '../../../src/modules/admin/identity/admin-identity.module';
import {
  ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS,
  ADMIN_PLATFORM_CONFIG_CONTROLLERS,
  ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS,
  AdminPlatformConfigModule,
} from '../../../src/modules/admin/platform-config/admin-platform-config.module';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';

/**
 * 查询 测试断言数据。
 * @param moduleClass - Nest 模块类；读取装饰器 metadata。
 * @param key - 键名；读取装饰器 metadata。
 * @returns 测试断言查询结果。
 */
const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

describe('Admin module route contract', () => {
  it('keeps legacy Admin route paths available from the new module boundary', () => {
    const routes = collectControllerRoutes([
      ...ADMIN_IDENTITY_CONTROLLERS,
      ...ADMIN_PLATFORM_CONFIG_CONTROLLERS,
    ]);

    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'GET /auth/password-public-key',
        'POST /auth/login',
        'POST /auth/refresh',
        'POST /auth/logout',
        'GET /auth/codes',
        'GET /menu/all',
        'GET /user/info',
        'PUT /user/profile',
        'GET /system/user/list',
        'POST /system/user',
        'PUT /system/user/:id',
        'DELETE /system/user/:id',
        'GET /system/menu/list',
        'GET /system/menu/name-exists',
        'GET /system/menu/path-exists',
        'POST /system/menu',
        'PUT /system/menu/:id',
        'DELETE /system/menu/:id',
        'GET /system/role/list',
        'POST /system/role',
        'PUT /system/role/:id',
        'DELETE /system/role/:id',
        'GET /system/dept/list',
        'POST /system/dept',
        'PUT /system/dept/:id',
        'DELETE /system/dept/:id',
        'GET /dict/list',
        'GET /dict/tree',
        'GET /dict/groups',
        'GET /dict/codes',
        'GET /dict/getDictByKey',
        'GET /dict/getComponentDictByType',
        'POST /dict/save',
        'POST /dict/update',
        'DELETE /dict/:id',
        'POST /dict/toggle',
        'GET /system/notice/list',
        'GET /system/notice/detail/:id',
        'DELETE /system/notice/:id',
        'POST /system/notice/toggle',
        'POST /system/notice/top',
      ]),
    );
  });

  it('keeps dict and notice reachable through platform-config module imports', () => {
    expect(getModuleMetadata(AdminModule, MODULE_METADATA.IMPORTS)).toEqual(
      expect.arrayContaining([AdminIdentityModule, AdminPlatformConfigModule]),
    );

    expect(
      getModuleMetadata(AdminPlatformConfigModule, MODULE_METADATA.IMPORTS),
    ).toEqual(expect.arrayContaining([DictModule, NoticeModule]));

    const directControllers = getModuleMetadata(
      AdminPlatformConfigModule,
      MODULE_METADATA.CONTROLLERS,
    );

    expect(directControllers).toEqual(
      expect.arrayContaining(ADMIN_PLATFORM_CONFIG_DIRECT_CONTROLLERS),
    );
    expect(directControllers).not.toEqual(
      expect.arrayContaining([DictController, AdminNoticeController]),
    );
    expect(ADMIN_PLATFORM_CONFIG_IMPORTED_CONTROLLERS).toEqual(
      expect.arrayContaining([DictController, AdminNoticeController]),
    );
  });
});
