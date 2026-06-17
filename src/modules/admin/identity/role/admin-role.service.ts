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
  /**
   * 初始化 AdminRoleService 实例。
   * @param roleRepository - 角色仓库依赖；影响 constructor 的返回值。
   * @param menuRepository - 菜单仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  /**
   * 查询 Admin 身份权限数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
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
   * 创建 Admin 身份权限对象或配置。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
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
   * 更新Role。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
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
   * 删除Role。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
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
   * 序列化Role。
   * @param role - role 输入；使用 `createTime`、`id`、`name`、`menus` 字段生成结果。
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
   * 查询 Admin 身份权限数据。
   * @param ids - Admin ID 列表；限定本次批量读取、渲染或关联的Admin范围。
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
   * 创建 Admin 身份权限对象或配置。
   * @param name - 名称文本；生成 Admin对象。
   */
  private createRoleCode(name?: string) {
    const slug = (name || 'role')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `${slug || 'role'}_${Date.now()}`;
  }
}
