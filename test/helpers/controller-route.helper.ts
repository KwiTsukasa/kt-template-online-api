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

const toPaths = (path?: string | string[]): string[] => {
  if (path === undefined) {
    return [''];
  }

  return Array.isArray(path) ? path : [path];
};

const normalizePath = (...segments: string[]) => {
  const path = segments
    .map((segment) => `${segment}`.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return path ? `/${path}` : '/';
};

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

export const routeKey = ({
  method,
  path,
}: Pick<ControllerRoute, 'method' | 'path'>) => `${method} ${path}`;
