import { AdminMenuService } from '../../src/modules/admin/identity/menu/admin-menu.service';
import type { AdminMenu } from '../../src/modules/admin/identity/menu/admin-menu.entity';
import type { AdminUser } from '../../src/modules/admin/identity/user/admin-user.entity';

describe('AdminMenuService', () => {
  const blogMenus = [
    createMenu({
      id: '2041700000000100300',
      meta: { title: '博客管理' },
      name: 'Blog',
      path: '/blog',
      pid: '0',
      type: 'catalog',
    }),
    createMenu({
      authCode: 'Blog:Theme:List',
      component: '/blog/theme/config',
      id: '2041700000000100304',
      meta: { title: '主题配置' },
      name: 'BlogTheme',
      path: '/blog/theme',
      pid: '2041700000000100300',
      type: 'menu',
    }),
    createMenu({
      authCode: 'Blog:Theme:Import',
      id: '2041700000000120332',
      meta: { title: '导入 WordPress' },
      name: 'BlogThemeImport',
      pid: '2041700000000100304',
      type: 'button',
    }),
  ];

  it('keeps local Blog menus visible for super users', async () => {
    const service = new AdminMenuService({
      find: jest.fn(async () => blogMenus),
    } as any);
    const user = {
      roles: [
        {
          isDeleted: false,
          roleCode: 'super',
          status: 1,
        },
      ],
    } as AdminUser;

    const routeMenus = await service.getRouteMenus(user);
    const accessCodes = await service.getAccessCodes(user);

    expect(routeMenus).toEqual([
      expect.objectContaining({
        children: [
          expect.objectContaining({
            name: 'BlogTheme',
            path: '/blog/theme',
          }),
        ],
        name: 'Blog',
        path: '/blog',
      }),
    ]);
    expect(accessCodes).toEqual(
      expect.arrayContaining(['Blog:Theme:List', 'Blog:Theme:Import']),
    );
  });

  it('returns and orders menus by the persisted sort field', async () => {
    const service = new AdminMenuService({
      find: jest.fn(async () => [
        createMenu({
          id: '2',
          meta: { title: 'Second' },
          name: 'Second',
          path: '/second',
          sort: 20,
          type: 'menu',
        }),
        createMenu({
          id: '1',
          meta: { title: 'First' },
          name: 'First',
          path: '/first',
          sort: 10,
          type: 'menu',
        }),
      ]),
    } as any);
    const user = {
      roles: [
        {
          isDeleted: false,
          roleCode: 'super',
          status: 1,
        },
      ],
    } as AdminUser;

    await expect(service.getRouteMenus(user)).resolves.toEqual([
      expect.objectContaining({ name: 'First', sort: 10 }),
      expect.objectContaining({ name: 'Second', sort: 20 }),
    ]);
  });

  it('persists menu sort values from create and update inputs', async () => {
    const repository = {
      create: jest.fn((input) => input),
      save: jest.fn(),
      update: jest.fn(),
    };
    const service = new AdminMenuService(repository as any);

    await service.createMenu({
      name: 'SortedMenu',
      path: '/sorted',
      sort: 8,
      type: 'menu',
    } as any);
    await service.updateMenu('menu-1', {
      name: 'SortedMenu',
      path: '/sorted',
      sort: 9,
      type: 'menu',
    } as any);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 8 }),
    );
    expect(repository.update).toHaveBeenCalledWith(
      {
        id: 'menu-1',
      },
      expect.objectContaining({ sort: 9 }),
    );
  });
});

/**
 * 创建 测试断言对象或配置。
 * @param menu - menu 输入；构造时间对象。
 * @returns 创建后的 测试断言对象或配置。
 */
function createMenu(menu: Partial<AdminMenu>): AdminMenu {
  return {
    authCode: null,
    component: null,
    createTime: new Date('2026-06-05T00:00:00Z'),
    id: '',
    isDeleted: false,
    meta: {},
    name: '',
    path: null,
    pid: '0',
    redirect: null,
    roles: [],
    sort: 0,
    status: 1,
    type: 'menu',
    updateTime: new Date('2026-06-05T00:00:00Z'),
    ...menu,
  } as AdminMenu;
}
