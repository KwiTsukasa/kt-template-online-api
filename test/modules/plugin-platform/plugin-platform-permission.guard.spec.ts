import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PLUGIN_PLATFORM_PERMISSION,
  PluginPlatformPermission,
  PluginPlatformPermissionGuard,
} from '../../../src/modules/plugin-platform/contract/plugin-platform-permission.guard';
import { PluginController } from '../../../src/modules/plugin-platform/contract/plugin-catalog.controller';
import { PluginPlatformController } from '../../../src/modules/plugin-platform/contract/plugin-platform.controller';
import { PluginPlatformTaskController } from '../../../src/modules/plugin-platform/contract/plugin-platform-task.controller';

type RoleInput = {
  isDeleted?: boolean;
  menus?: Array<{
    authCode?: string;
    isDeleted?: boolean;
    status?: number;
  }>;
  roleCode?: string;
  status?: number;
};

const contextFor = (
  roles: RoleInput[] | undefined,
  handler: () => void,
): ExecutionContext =>
  ({
    getClass: () => class TestController {},
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ adminUser: roles ? { roles } : undefined }),
    }),
  }) as unknown as ExecutionContext;

const handlerWithPermission = (...authCodes: string[]): (() => void) => {
  class PermissionFixture {
    /**
     * 提供只用于权限元数据断言的空处理入口。
     */
    @PluginPlatformPermission(...authCodes)
    run(): void {}
  }
  return PermissionFixture.prototype.run;
};

describe('PluginPlatformPermissionGuard', () => {
  const guard = new PluginPlatformPermissionGuard(new Reflector());

  it('binds every controller family to the new explicit permission namespaces', () => {
    expect(
      Reflect.getMetadata(PLUGIN_PLATFORM_PERMISSION, PluginController),
    ).toEqual(['PluginPlatform:Plugin:List']);
    expect(
      Reflect.getMetadata(PLUGIN_PLATFORM_PERMISSION, PluginPlatformController),
    ).toEqual(['PluginPlatform:Plugin:List']);
    expect(
      Reflect.getMetadata(
        PLUGIN_PLATFORM_PERMISSION,
        PluginPlatformTaskController,
      ),
    ).toEqual(['PluginPlatform:Task:List']);

    const pluginActions = {
      config: 'Config',
      disable: 'Disable',
      enable: 'Enable',
      install: 'Install',
      installLocal: 'Install',
      uninstall: 'Uninstall',
      upgrade: 'Upgrade',
      upload: 'Install',
      validate: 'Install',
    } as const;
    Object.entries(pluginActions).forEach(([method, action]) => {
      expect(
        Reflect.getMetadata(
          PLUGIN_PLATFORM_PERMISSION,
          PluginPlatformController.prototype[method],
        ),
      ).toEqual([`PluginPlatform:Plugin:${action}`]);
    });

    const taskActions = {
      disable: 'Disable',
      enable: 'Enable',
      run: 'Run',
      runs: 'RunLog',
      updateCron: 'UpdateCron',
    } as const;
    Object.entries(taskActions).forEach(([method, action]) => {
      expect(
        Reflect.getMetadata(
          PLUGIN_PLATFORM_PERMISSION,
          PluginPlatformTaskController.prototype[method],
        ),
      ).toEqual([`PluginPlatform:Task:${action}`]);
    });
  });

  it.each([
    'PluginPlatform:Plugin:List',
    'PluginPlatform:Plugin:Install',
    'PluginPlatform:Task:List',
    'PluginPlatform:Task:Run',
  ])('accepts the exact active permission %s', (authCode) => {
    const handler = handlerWithPermission(authCode);

    expect(
      guard.canActivate(
        contextFor(
          [
            {
              menus: [{ authCode, status: 1 }],
              roleCode: 'operator',
              status: 1,
            },
          ],
          handler,
        ),
      ),
    ).toBe(true);
  });

  it('rejects the retired Bot task permission namespace', () => {
    const handler = handlerWithPermission('PluginPlatform:Task:Run');

    expect(() =>
      guard.canActivate(
        contextFor(
          [
            {
              menus: [{ authCode: 'Bot:PluginTask:Run', status: 1 }],
              roleCode: 'operator',
              status: 1,
            },
          ],
          handler,
        ),
      ),
    ).toThrow(HttpException);
  });

  it('allows only active super roles to bypass explicit permissions', () => {
    const handler = handlerWithPermission('PluginPlatform:Plugin:List');

    expect(
      guard.canActivate(
        contextFor([{ roleCode: 'super', status: 1 }], handler),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        contextFor([{ roleCode: 'super', status: 0 }], handler),
      ),
    ).toThrow(HttpException);
  });

  it('fails closed without route metadata or an authenticated Admin user', () => {
    const unprotectedHandler = () => undefined;
    const protectedHandler = handlerWithPermission(
      'PluginPlatform:Plugin:List',
    );

    expect(() => guard.canActivate(contextFor([], unprotectedHandler))).toThrow(
      HttpException,
    );
    expect(() =>
      guard.canActivate(contextFor(undefined, protectedHandler)),
    ).toThrow(HttpException);
  });
});
