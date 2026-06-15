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
});

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
