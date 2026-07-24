import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QqbotMessagePushPermissionGuard } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-permission.guard';
import { QqbotMessagePushPermission } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-permission.decorator';

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

/** Builds the smallest HTTP execution context used by the permission guard. */
const contextFor = (
  roles: RoleInput[],
  handler: () => void = () => undefined,
): ExecutionContext =>
  ({
    getClass: () => class TestController {},
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ adminUser: { roles } }),
    }),
  }) as unknown as ExecutionContext;

/** Creates a handler decorated with one exact management permission. */
const handlerWithPermission = (...authCodes: string[]): (() => void) => {
  class PermissionFixture {
    @QqbotMessagePushPermission(...authCodes)
    run(): void {}
  }
  return PermissionFixture.prototype.run;
};

describe('QqbotMessagePushPermissionGuard', () => {
  const guard = new QqbotMessagePushPermissionGuard(new Reflector());
  const handler = handlerWithPermission('QqBot:MessageTemplate:Preview');

  it('allows only an active non-deleted super assignment to bypass', () => {
    expect(
      guard.canActivate(
        contextFor(
          [{ isDeleted: false, roleCode: 'super', status: 1 }],
          handler,
        ),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        contextFor(
          [{ isDeleted: true, roleCode: 'super', status: 1 }],
          handler,
        ),
      ),
    ).toThrow(HttpException);
    expect(() =>
      guard.canActivate(
        contextFor(
          [{ isDeleted: false, roleCode: 'super', status: 0 }],
          handler,
        ),
      ),
    ).toThrow(HttpException);
  });

  it('uses only active roles and active exact-code menus', () => {
    expect(
      guard.canActivate(
        contextFor(
          [
            {
              isDeleted: false,
              menus: [
                {
                  authCode: 'QqBot:MessageSubscription:List',
                  isDeleted: false,
                  status: 1,
                },
                {
                  authCode: 'QqBot:MessageTemplate:Preview',
                  isDeleted: false,
                  status: 1,
                },
              ],
              roleCode: 'operator',
              status: 1,
            },
          ],
          handler,
        ),
      ),
    ).toBe(true);

    for (const roles of [
      [
        {
          isDeleted: true,
          menus: [
            {
              authCode: 'QqBot:MessageTemplate:Preview',
              isDeleted: false,
              status: 1,
            },
          ],
          status: 1,
        },
      ],
      [
        {
          isDeleted: false,
          menus: [
            {
              authCode: 'QqBot:MessageTemplate:Preview',
              isDeleted: false,
              status: 1,
            },
          ],
          status: 0,
        },
      ],
      [
        {
          isDeleted: false,
          menus: [
            {
              authCode: 'QqBot:MessageTemplate:Preview',
              isDeleted: true,
              status: 1,
            },
          ],
          status: 1,
        },
      ],
      [
        {
          isDeleted: false,
          menus: [
            {
              authCode: 'QqBot:MessageTemplate:Preview',
              isDeleted: false,
              status: 0,
            },
          ],
          status: 1,
        },
      ],
    ]) {
      expect(() => guard.canActivate(contextFor(roles, handler))).toThrow(
        HttpException,
      );
    }
  });

  it('fails closed when route metadata is missing or empty', () => {
    expect(() => guard.canActivate(contextFor([]))).toThrow(HttpException);

    class EmptyPermissionFixture {
      @QqbotMessagePushPermission()
      run(): void {}
    }
    expect(() =>
      guard.canActivate(contextFor([], EmptyPermissionFixture.prototype.run)),
    ).toThrow(HttpException);
  });

  it.each([
    [
      'source read',
      [
        'QqBot:MessageSubscription:List',
        'QqBot:MessageSubscription:Create',
        'QqBot:MessageSubscription:Update',
        'QqBot:MessageTemplate:List',
        'QqBot:MessageTemplate:Create',
        'QqBot:MessageTemplate:Update',
        'QqBot:MessageTemplate:Preview',
        'QqBot:Account:MessagePush:List',
        'QqBot:Account:MessagePush:Create',
        'QqBot:Account:MessagePush:Update',
      ],
    ],
    [
      'source options',
      [
        'QqBot:MessageSubscription:Create',
        'QqBot:MessageSubscription:Update',
        'QqBot:Account:MessagePush:Create',
        'QqBot:Account:MessagePush:Update',
      ],
    ],
    [
      'subscription read',
      [
        'QqBot:MessageSubscription:List',
        'QqBot:Account:MessagePush:List',
        'QqBot:Account:MessagePush:Create',
        'QqBot:Account:MessagePush:Update',
      ],
    ],
    [
      'template read',
      [
        'QqBot:MessageTemplate:List',
        'QqBot:Account:MessagePush:List',
        'QqBot:Account:MessagePush:Create',
        'QqBot:Account:MessagePush:Update',
      ],
    ],
    [
      'target read',
      ['QqBot:Account:MessagePush:Create', 'QqBot:Account:MessagePush:Update'],
    ],
  ])('accepts every independent %s OR permission', (_label, authCodes) => {
    const routeHandler = handlerWithPermission(...authCodes);
    authCodes.forEach((authCode) => {
      expect(
        guard.canActivate(
          contextFor(
            [
              {
                isDeleted: false,
                menus: [{ authCode, isDeleted: false, status: 1 }],
                roleCode: 'operator',
                status: 1,
              },
            ],
            routeHandler,
          ),
        ),
      ).toBe(true);
    });
  });

  it.each([
    ['QqBot:MessageSubscription:Create', 'QqBot:MessageSubscription:List'],
    ['QqBot:MessageSubscription:Update', 'QqBot:MessageSubscription:Create'],
    ['QqBot:MessageTemplate:Delete', 'QqBot:MessageTemplate:List'],
    ['QqBot:Account:MessagePush:Toggle', 'QqBot:Account:MessagePush:Update'],
  ])(
    'does not let neighboring code %s grant mutation %s',
    (required, neighboring) => {
      expect(() =>
        guard.canActivate(
          contextFor(
            [
              {
                isDeleted: false,
                menus: [{ authCode: neighboring, isDeleted: false, status: 1 }],
                roleCode: 'operator',
                status: 1,
              },
            ],
            handlerWithPermission(required),
          ),
        ),
      ).toThrow(HttpException);
    },
  );

  it('fails closed when JwtAuthGuard did not populate adminUser', () => {
    const missingUserContext = {
      getClass: () => class TestController {},
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(missingUserContext)).toThrow(HttpException);
  });
});
