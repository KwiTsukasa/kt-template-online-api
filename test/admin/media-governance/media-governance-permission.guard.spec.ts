import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MEDIA_GOVERNANCE_PERMISSION,
  MediaGovernancePermissionGuard,
} from '../../../src/modules/admin/media-governance/media-governance-permission.guard';

function createContext(roles: unknown[]): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(
    MEDIA_GOVERNANCE_PERMISSION,
    ['Media:Governance:List'],
    handler,
  );
  return {
    getClass: () => class MediaGovernanceTestController {},
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ adminUser: { roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('MediaGovernancePermissionGuard', () => {
  const guard = new MediaGovernancePermissionGuard(new Reflector());

  it('allows an active super role', () => {
    expect(
      guard.canActivate(
        createContext([{ isDeleted: false, roleCode: 'super', status: 1 }]),
      ),
    ).toBe(true);
  });

  it('allows an active role carrying the declared permission', () => {
    expect(
      guard.canActivate(
        createContext([
          {
            isDeleted: false,
            menus: [
              {
                authCode: 'Media:Governance:List',
                isDeleted: false,
                status: 1,
              },
            ],
            roleCode: 'media-operator',
            status: 1,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('rejects missing, disabled and deleted permission rows', () => {
    for (const roles of [
      [],
      [
        {
          isDeleted: false,
          menus: [
            {
              authCode: 'Media:Governance:List',
              isDeleted: false,
              status: 0,
            },
          ],
          roleCode: 'media-operator',
          status: 1,
        },
      ],
    ]) {
      expect(() => guard.canActivate(createContext(roles))).toThrow(
        HttpException,
      );
    }
  });
});
