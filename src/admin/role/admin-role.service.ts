import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminMenu } from '../menu/admin-menu.entity';
import { AdminRole } from './admin-role.entity';

type RoleInput = Partial<AdminRole> & {
  permissions?: string[];
};

type ListQuery = Record<string, any>;

@Injectable()
export class AdminRoleService {
  constructor(
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminMenu)
    private readonly menuRepository: Repository<AdminMenu>,
  ) {}

  async getRoleList(query: ListQuery) {
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

  async createRole(data: RoleInput) {
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

  async updateRole(id: string, data: RoleInput) {
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
    if (data.permissions) role.menus = await this.findMenusByIds(data.permissions);

    await this.roleRepository.save(role);
    return null;
  }

  async deleteRole(id: string) {
    await this.roleRepository.update(
      { id },
      {
        isDeleted: true,
      },
    );
    return null;
  }

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

  private createRoleCode(name?: string) {
    const slug = (name || 'role')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `${slug || 'role'}_${Date.now()}`;
  }
}
