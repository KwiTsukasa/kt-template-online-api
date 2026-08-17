import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminMenu } from '../menu/admin-menu.entity';
import { AdminRole } from './admin-role.entity';
import type {
  AdminRoleInput,
  AdminRoleListQuery,
} from '../../contract/admin.types';

@Injectable()
export class AdminRoleService {
  constructor(
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  /**
   * 通过 `where` 筛选匹配数据。
   * @param query - 限定角色筛选、排序与分页范围的查询条件，包含 `page`、`pageSize`、`id`、`name` 字段。
   * @returns 包含 `items`、`total` 字段的角色。
   */
  async getRoleList(query: AdminRoleListQuery) {
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    const builder = this.roleRepository
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.menus', 'menu')
      .where('role.isDeleted = :isDeleted', { isDeleted: false });

    if (query.id) builder.andWhere('role.id LIKE :id', { id: `%${query.id}%` });
    if (query.name) {
      builder.andWhere('role.name LIKE :name', { name: `%${query.name}%` });
    }
    if (query.remark) {
      builder.andWhere('role.remark LIKE :remark', {
        remark: `%${query.remark}%`,
      });
    }
    if (['0', '1'].includes(String(query.status))) {
      builder.andWhere('role.status = :status', {
        status: Number(query.status),
      });
    }
    if (query.startTime) {
      builder.andWhere('role.createTime >= :startTime', {
        startTime: query.startTime,
      });
    }
    if (query.endTime) {
      builder.andWhere('role.createTime <= :endTime', {
        endTime: query.endTime,
      });
    }

    const [roles, total] = await builder
      .orderBy('role.createTime', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: roles.map((role) => this.serializeRole(role)),
      total,
    };
  }

  /**
   * 根据`data`构造角色；把变更持久化到当前存储（`roleRepository.create`）。
   * @param data - 用于角色的领域对象，包含 `name`、`remark`、`status`、`permissions` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生角色。
   */
  async createRole(data: AdminRoleInput) {
    const role = this.roleRepository.create({
      name: data.name,
      remark: data.remark || '',
      roleCode: this.createRoleCode(data.name),
      status: data.status ?? 1,
    });
    role.menus = await this.findMenusByIds(data.permissions || []);
    await this.roleRepository.save(role);
    return null;
  }

  /**
   * 根据`id`、`data`更新角色；把变更持久化到当前存储（`roleRepository.save`）。
   * @param id - 决定角色内容、边界或目标的 `id` 值。
   * @param data - 用于角色的领域对象，包含 `name`、`remark`、`status`、`permissions` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生角色。
   */
  async updateRole(id: string, data: AdminRoleInput) {
    const role = await this.roleRepository.findOne({
      relations: ['menus'],
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!role) throwVbenError('角色不存在', HttpStatus.BAD_REQUEST);

    if (data.name !== undefined) role.name = data.name;
    if (data.remark !== undefined) role.remark = data.remark;
    if (data.status !== undefined) role.status = data.status;
    if (data.permissions)
      role.menus = await this.findMenusByIds(data.permissions);

    await this.roleRepository.save(role);
    return null;
  }

  /**
   * 按角色标识写入软删除标记，保留角色及其关联数据以供历史查询。
   * @param id - 决定按角色标识写入软删除标记，保留角色及其关联数据以供历史查询内容、边界或目标的 `id` 值。
   * @returns 固定为 `null`，表示当前入口不会产生按角色标识写入软删除标记，保留角色及其关联数据以供历史查询。
   */
  async deleteRole(id: string) {
    await this.roleRepository.update(
      { id },
      {
        isDeleted: true,
      },
    );
    return null;
  }

  /**
   * 将角色实体投影为管理端角色详情，以关联菜单标识组成权限列表。
   * @param role - 待展示的角色实体；未加载菜单关系时按空数组处理。
   * @returns 返回角色基本字段及其菜单权限标识列表。
   */
  private serializeRole(role: AdminRole) {
    return {
      createTime: role.createTime,
      id: role.id,
      name: role.name,
      permissions: (role.menus || []).map((menu) => menu.id),
      remark: role.remark,
      status: role.status,
    };
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param ids - 决定Menus标识集合内容、边界或目标的 `ids` 值。
   * @returns Menus标识集合。
   */
  private async findMenusByIds(ids: string[]) {
    const normalizedIds = ids.map((id) => String(id)).filter(Boolean);
    if (!normalizedIds.length) return [];
    return this.menuRepository.find({
      where: normalizedIds.map((id) => ({
        id,
        isDeleted: false,
      })),
    });
  }

  /**
   * 根据`name`构造角色代码。
   * @param name - 决定角色代码内容、边界或目标的 `name` 值；为空时采用 `'role'` 作为兜底。
   * @returns 按参数编码并拼接完成的角色代码。
   */
  private createRoleCode(name?: string) {
    const slug = (name || 'role')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `${slug || 'role'}_${Date.now()}`;
  }
}
