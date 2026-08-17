import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toTree } from '@/common';
import { AdminUser } from '../user/admin-user.entity';
import { AdminMenu } from './admin-menu.entity';
import type { AdminMenuInput, AdminMenuMeta } from '../../contract/admin.types';

@Injectable()
export class AdminMenuService {
  constructor(
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  /**
   * 按`user`读取访问权限码集合；从 `getAllowedMenus` 读取访问权限码集合。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 访问权限码集合。
   */
  async getAccessCodes(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return menus.map((menu) => menu.authCode).filter((authCode) => !!authCode);
  }

  /**
   * 按`user`读取路由Menus；从 `getAllowedMenus` 读取路由Menus。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 路由Menus。
   */
  async getRouteMenus(user: AdminUser) {
    const menus = await this.getAllowedMenus(user);
    return this.buildMenuTree(menus.filter((menu) => menu.type !== 'button'));
  }

  /**
   * 按当前运行态读取菜单。
   * @returns 菜单。
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
   * 根据`name`、`id`与当前约束判定菜单名称Exists；从 `menuRepository.findOne` 读取菜单名称Exists。
   * @param name - 决定菜单名称Exists内容、边界或目标的 `name` 值。
   * @param id - 决定菜单名称Exists内容、边界或目标的 `id` 值；为空时采用 `menu.id !== id` 作为兜底。
   * @returns 满足菜单名称Exists约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`path`、`id`与当前约束判定菜单路径Exists；从 `menuRepository.findOne` 读取菜单路径Exists。
   * @param path - 必须保持在受控根目录内的路径。
   * @param id - 决定菜单路径Exists内容、边界或目标的 `id` 值；为空时采用 `menu.id !== id` 作为兜底。
   * @returns 满足菜单路径Exists约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`data`构造菜单；把变更持久化到当前存储（`menuRepository.create`）。
   * @param data - 决定菜单内容、边界或目标的 `data` 值。
   * @returns 固定为 `null`，表示当前入口不会产生菜单。
   */
  async createMenu(data: AdminMenuInput) {
    const entity = this.menuRepository.create({
      ...this.normalizeMenuInput(data, true),
    });
    await this.menuRepository.save(entity);
    return null;
  }

  /**
   * 根据`id`、`data`更新菜单；把变更持久化到当前存储（`menuRepository.update`）。
   * @param id - 决定菜单内容、边界或目标的 `id` 值。
   * @param data - 决定菜单内容、边界或目标的 `data` 值。
   * @returns 固定为 `null`，表示当前入口不会产生菜单。
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
   * 通过 `collectChildMenuIds` 收集候选数据。
   * @param id - 决定菜单内容、边界或目标的 `id` 值。
   * @returns 固定为 `null`，表示当前入口不会产生菜单。
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
   * 通过 `filter` 筛选匹配数据。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 许可范围Menus。
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
   * 根据`menus`处理include祖先节点Menus。
   * @param menus - 决定include祖先节点Menus内容、边界或目标的 `menus` 值。
   * @returns 按输入顺序得到的include祖先节点Menus列表；没有匹配项时为空数组。
   */
  private async includeAncestorMenus(menus: AdminMenu[]) {
    const menuMap = new Map<string, AdminMenu>();
    menus.forEach((menu) => menuMap.set(menu.id, menu));

    const pendingParentIds = new Set<string>();
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
   * 将菜单输入投影为持久化字段并规范化元数据；调用方要求或元数据非空时才写入 `meta`。
   * @param data - 用于将菜单输入投影为持久化字段并规范化元数据的领域对象，包含 `authCode`、`component`、`name`、`path` 字段。
   * @param includeEmptyMeta - 决定是否启用“includeEmptyMeta”分支的布尔选项。
   * @returns 将菜单输入投影为持久化字段并规范化元数据。
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
      sort: Number(data.sort ?? 0),
      type: data.type || 'menu',
    };
    if (includeEmptyMeta || Object.keys(meta).length > 0) {
      menu.meta = meta;
    }
    return menu;
  }

  /**
   * 将`data`规范为Meta输入，使等价输入得到一致表示。
   * @param data - 用于Meta输入的领域对象，包含 `meta`、`activePath`、`linkSrc`、`type` 字段。
   * @returns Meta输入。
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
   * 将菜单元数据收敛为独立对象；空值、非对象 JSON 或解析失败时返回空对象。
   * @param meta - 决定将菜单元数据收敛为独立对象内容、边界或目标的 `meta` 值。
   * @returns 将菜单元数据收敛为独立对象。
   */
  private normalizeMetaValue(
    meta: AdminMenuMeta | null | string | undefined,
  ): AdminMenuMeta {
    if (!meta) return {};
    if (typeof meta !== 'string') return { ...meta };

    try {
      const parsed = JSON.parse(meta);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * 根据`id`处理子级菜单标识集合。
   * @param id - 决定子级菜单标识集合内容、边界或目标的 `id` 值。
   * @returns 按输入顺序得到的子级菜单标识集合列表；没有匹配项时为空数组。
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
   * 根据`menus`构造菜单树形层级。
   * @param menus - 决定菜单树形层级内容、边界或目标的 `menus` 值。
   * @returns 菜单树形层级。
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
   * 将菜单实体投影为路由树节点，补全缺失的标题并剔除空字段。
   * @param menu - 待转换的菜单实体；`meta` 会被标准化，其标题缺失时回退为菜单名。
   * @returns 返回仅保留有效值的路由菜单节点。
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
      sort: menu.sort,
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
