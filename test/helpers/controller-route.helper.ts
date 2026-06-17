import { RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ControllerRoute } from '../test.types';

const requestMethodMap: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

/**
 * 执行 测试断言流程。
 * @param path - 路由或文件路径；驱动 `Array.isArray()` 的 测试步骤。
 * @returns 测试断言渲染后的图片、画布或文本。
 */
const toPaths = (path?: string | string[]): string[] => {
  if (path === undefined) {
    return [''];
  }

  return Array.isArray(path) ? path : [path];
};

/**
 * 转换 测试断言输入。
 * @param segments - 测试列表；影响 normalizePath 的返回值。
 */
const normalizePath = (...segments: string[]) => {
  const path = segments
    .map((segment) => `${segment}`.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return path ? `/${path}` : '/';
};

/**
 * 执行 测试断言流程。
 * @param controllers - Controller 类列表；影响 collectControllerRoutes 的返回值。
 * @returns 测试断言产出的 ControllerRoute[]。
 */
export const collectControllerRoutes = (
  controllers: Type<unknown>[],
): ControllerRoute[] => {
  return controllers
    .flatMap((ControllerClass) => {
      const controllerPaths = toPaths(
        Reflect.getMetadata(PATH_METADATA, ControllerClass),
      );
      const prototype = ControllerClass.prototype;

      return Object.getOwnPropertyNames(prototype).flatMap((handlerName) => {
        if (handlerName === 'constructor') {
          return [];
        }

        const handler = prototype[handlerName];
        const requestMethod: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );

        if (requestMethod === undefined) {
          return [];
        }

        const method = requestMethodMap[requestMethod];

        if (!method) {
          return [];
        }

        const routePaths = toPaths(Reflect.getMetadata(PATH_METADATA, handler));

        return controllerPaths.flatMap((controllerPath) =>
          routePaths.map((routePath) => ({
            controllerName: ControllerClass.name,
            handlerName,
            method,
            path: normalizePath(controllerPath, routePath),
          })),
        );
      });
    })
    .sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
};

/**
 * 执行 测试断言流程。
 * @param { method, path, } - 收集到的 ControllerRoute 核心字段，用于拼接排序和断言时使用的稳定 key。
 */
export const routeKey = ({
  method,
  path,
}: Pick<ControllerRoute, 'method' | 'path'>) => `${method} ${path}`;
