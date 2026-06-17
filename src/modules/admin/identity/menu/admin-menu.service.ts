import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toTree } from '@/common';
import { AdminUser } from '../user/admin-user.entity';
import { AdminMenu } from './admin-menu.entity';
import type { AdminMenuInput, AdminMenuMeta } from '../../contract/admin.types';

@Injectable()
export class AdminMenuService {
  /**
   * 初始化 AdminMenuService 实例。
   * @param menuRepository - 菜单仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  /**
   * 查询 Admin 身份权限数据。
   * @param user - user 输入；驱动 `this.getAllowedMenus()` 的 Admin步骤。
   */
  async getAccessCodes(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return menus.map((menu) => menu.authCode).filter((authCode) => !!authCode);
  }

  /**
   * 查询 Admin 身份权限数据。
   * @param user - user 输入；驱动 `this.getAllowedMenus()` 的 Admin步骤。
   */
  async getRouteMenus(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return this.buildMenuTree(menus.filter((menu) => menu.type !== 'button'));
  }

  /**
   * 查询 Admin 身份权限数据。
   */
  async getMenuList() {
    const menus = await this.menuRepository.find({
      where: {
        isDeleted: false,
      },
    });
    return this.buildMenuTree(menus);
  }

  /**
   * 判断 Admin 身份权限条件。
   * @param name - 名称文本；计算 Admin判断结果。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  async isMenuNameExists(name: string, id?: string) {
    const menu = await this.menuRepository.findOne({
      where: {
        isDeleted: false,
        name,
      },
    });
    return !!menu && (!id || menu.id !== id);
  }

  /**
   * 判断 Admin 身份权限条件。
   * @param path - 路由或文件路径；决定 Admin条件分支。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
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

  /**
   * 创建 Admin 身份权限对象或配置。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   */
  async createMenu(data: AdminMenuInput) {
    const entity = this.menuRepository.create({
      ...this.normalizeMenuInput(data, true),
    });
    await this.menuRepository.save(entity);
    return null;
  }

  /**
   * 更新Menu。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   */
  async updateMenu(id: string, data: AdminMenuInput) {
    await this.menuRepository.update(
      { id },
      {
        ...this.normalizeMenuInput(data, false),
      },
    );
    return null;
  }

  /**
   * 删除Menu。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
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

  /**
   * 查询 Admin 身份权限数据。
   * @param user - user 输入；使用 `roles` 字段生成结果。
   */
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
    return this.includeAncestorMenus([...menuMap.values()]);
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param menus - 菜单列表；遍历并累积 Admin结果。
   */
  private async includeAncestorMenus(menus: AdminMenu[]) {
    const menuMap = new Map<string, AdminMenu>();
    menus.forEach((menu) => menuMap.set(menu.id, menu));

    const pendingParentIds = new Set<string>();
    /**
     * 收集 Admin 管理数据。
     * @param pid - Admin ID；定位本次读取、更新、删除或关联的Admin。
     */
    const collectMissingParent = (pid?: null | string) => {
      if (!pid || pid === '0' || menuMap.has(pid)) return;
      pendingParentIds.add(pid);
    };

    menus.forEach((menu) => collectMissingParent(menu.pid));

    while (pendingParentIds.size > 0) {
      const ids = [...pendingParentIds];
      pendingParentIds.clear();
      const parents = await this.menuRepository.find({
        where: {
          id: In(ids),
          isDeleted: false,
          status: 1,
        },
      });

      parents.forEach((parent) => {
        if (menuMap.has(parent.id)) return;
        menuMap.set(parent.id, parent);
        collectMissingParent(parent.pid);
      });
    }

    return [...menuMap.values()];
  }

  /**
   * 转换 Admin 身份权限输入。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   * @param includeEmptyMeta - includeEmptyMeta 输入；决定 Admin条件分支。
   * @returns Admin 身份权限转换后的值。
   */
  private normalizeMenuInput(
    data: AdminMenuInput,
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

  /**
   * 转换 Admin 身份权限输入。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   * @returns Admin 身份权限转换后的值。
   */
  private normalizeMetaInput(data: AdminMenuInput): AdminMenuMeta {
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

  /**
   * 转换 Admin 身份权限输入。
   * @param meta - meta 输入；转换 JSON 文本。
   * @returns Admin 身份权限转换后的值。
   */
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

  /**
   * 执行 Admin 身份权限流程。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
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

  /**
   * 创建 Admin 身份权限对象或配置。
   * @param menus - 菜单列表；生成 Admin对象。
   */
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

  /**
   * 序列化Menu。
   * @param menu - menu 输入；使用 `meta`、`name`、`authCode`、`component` 字段生成结果。
   */
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
