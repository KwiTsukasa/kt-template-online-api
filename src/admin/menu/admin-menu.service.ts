import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toTree } from '@/common';
import { AdminUser } from '../user/admin-user.entity';
import { AdminMenu, AdminMenuMeta } from './admin-menu.entity';

type MenuInput = Partial<AdminMenu> & {
  activePath?: string;
  linkSrc?: string;
};

@Injectable()
export class AdminMenuService {
  constructor(
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  async getAccessCodes(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return menus
      .map((menu) => menu.authCode)
      .filter((authCode) => !!authCode);
  }

  async getRouteMenus(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return this.buildMenuTree(menus.filter((menu) => menu.type !== 'button'));
  }

  async getMenuList() {
    const menus = await this.menuRepository.find({
      where: {
        isDeleted: false,
      },
    });
    return this.buildMenuTree(menus);
  }

  async isMenuNameExists(name: string, id?: string) {
    const menu = await this.menuRepository.findOne({
      where: {
        isDeleted: false,
        name,
      },
    });
    return !!menu && (!id || menu.id !== id);
  }

  async isMenuPathExists(path: string, id?: string) {
    if (path === '/') return !id;

    const menu = await this.menuRepository.findOne({
      where: {
        isDeleted: false,
        path,
      },
    });
    return !!menu && (!id || menu.id !== id);
  }

  async createMenu(data: MenuInput) {
    const entity = this.menuRepository.create({
      ...this.normalizeMenuInput(data, true),
    });
    await this.menuRepository.save(entity);
    return null;
  }

  async updateMenu(id: string, data: MenuInput) {
    await this.menuRepository.update(
      { id },
      {
        ...this.normalizeMenuInput(data, false),
      },
    );
    return null;
  }

  async deleteMenu(id: string) {
    const ids = await this.collectChildMenuIds(id);
    await this.menuRepository.update(
      {
        id: In(ids),
      },
      {
        isDeleted: true,
      },
    );
    return null;
  }

  private async getAllowedMenus(user: AdminUser) {
    const activeRoles = (user.roles || []).filter(
      (role) => !role.isDeleted && role.status === 1,
    );

    if (activeRoles.some((role) => role.roleCode === 'super')) {
      return this.menuRepository.find({
        where: {
          isDeleted: false,
          status: 1,
        },
      });
    }

    const menuMap = new Map<string, AdminMenu>();
    activeRoles.forEach((role) => {
      (role.menus || [])
        .filter((menu) => !menu.isDeleted && menu.status === 1)
        .forEach((menu) => menuMap.set(menu.id, menu));
    });
    return [...menuMap.values()];
  }

  private normalizeMenuInput(
    data: MenuInput,
    includeEmptyMeta: boolean,
  ): Partial<AdminMenu> {
    const meta = this.normalizeMetaInput(data);
    const menu: Partial<AdminMenu> = {
      authCode: data.authCode || null,
      component: data.component || null,
      name: data.name,
      path: data.path || null,
      pid: data.pid || '0',
      redirect: data.redirect || null,
      status: data.status ?? 1,
      type: data.type || 'menu',
    };
    if (includeEmptyMeta || Object.keys(meta).length > 0) {
      menu.meta = meta;
    }
    return menu;
  }

  private normalizeMetaInput(data: MenuInput): AdminMenuMeta {
    const meta = this.normalizeMetaValue(data.meta);

    // 兼容表单库返回字面量 `meta.title` 的场景，避免更新菜单时把 meta 覆盖为空对象。
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith('meta.')) return;
      const metaKey = key.slice('meta.'.length);
      if (metaKey) meta[metaKey] = value;
    });

    if (data.activePath) meta.activePath = data.activePath;
    if (data.linkSrc && data.type === 'embedded') meta.iframeSrc = data.linkSrc;
    if (data.linkSrc && data.type === 'link') meta.link = data.linkSrc;

    Object.keys(meta).forEach((key) => {
      if (meta[key] === null || meta[key] === undefined || meta[key] === '') {
        delete meta[key];
      }
    });
    return meta;
  }

  private normalizeMetaValue(
    meta: AdminMenuMeta | null | string | undefined,
  ): AdminMenuMeta {
    if (!meta) return {};
    if (typeof meta !== 'string') return { ...meta };

    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async collectChildMenuIds(id: string) {
    const menus = await this.menuRepository.find({
      where: {
        isDeleted: false,
      },
    });
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      menus.forEach((menu) => {
        if (ids.has(menu.pid) && !ids.has(menu.id)) {
          ids.add(menu.id);
          changed = true;
        }
      });
    }
    return [...ids];
  }

  private buildMenuTree(menus: AdminMenu[]) {
    const nodes = menus
      .map((menu) => this.serializeMenu(menu))
      .sort((prev, next) => {
        const prevOrder = prev.meta?.order ?? prev.sort ?? 0;
        const nextOrder = next.meta?.order ?? next.sort ?? 0;
        return prevOrder - nextOrder;
      });
    return toTree(nodes);
  }

  private serializeMenu(menu: AdminMenu) {
    const meta = this.normalizeMetaValue(menu.meta);
    if (!meta.title) meta.title = menu.name;
    const node = {
      authCode: menu.authCode,
      component: menu.component,
      createTime: menu.createTime,
      id: menu.id,
      meta,
      name: menu.name,
      path: menu.path,
      pid: menu.pid || '0',
      redirect: menu.redirect,
      status: menu.status,
      type: menu.type,
    } as any;

    Object.keys(node).forEach((key) => {
      if (node[key] === null || node[key] === undefined || node[key] === '') {
        delete node[key];
      }
    });
    return node;
  }
}
