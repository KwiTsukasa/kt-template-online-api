import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminDept } from '../dept/admin-dept.entity';
import { AdminRole } from '../role/admin-role.entity';
import { AdminUser } from './admin-user.entity';
import type {
  AdminUserInput,
  AdminUserListQuery,
} from '../../contract/admin.types';

const BUILTIN_ADMIN_USER_ID = '2041700000000000002';
const DEFAULT_ADMIN_HOME_PATH = '/analytics';

@Injectable()
export class AdminUserService {
  /**
   * 初始化 AdminUserService 实例。
   * @param userRepository - 用户仓库依赖；影响 constructor 的返回值。
   * @param roleRepository - 角色仓库依赖；影响 constructor 的返回值。
   * @param deptRepository - Admin仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminDept)
    private readonly deptRepository: Repository<AdminDept>,
  ) {}

  /**
   * 查询 Admin 身份权限数据。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  async getUserList(query: AdminUserListQuery) {
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    const builder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('user.dept', 'dept')
      .where('user.isDeleted = :isDeleted', { isDeleted: false });

    if (query.id) {
      builder.andWhere('user.id LIKE :id', { id: `%${query.id}%` });
    }
    if (query.username) {
      builder.andWhere('user.username LIKE :username', {
        username: `%${query.username}%`,
      });
    }
    if (query.realName) {
      builder.andWhere('user.realName LIKE :realName', {
        realName: `%${query.realName}%`,
      });
    }
    if (['0', '1'].includes(String(query.status))) {
      builder.andWhere('user.status = :status', {
        status: Number(query.status),
      });
    }
    if (query.deptId) {
      const deptIds = await this.collectDeptIds(String(query.deptId));
      builder.andWhere('user.deptId IN (:...deptIds)', { deptIds });
    }
    if (query.roleId) {
      builder.andWhere('role.id = :roleId', { roleId: String(query.roleId) });
    }
    if (query.startTime) {
      builder.andWhere('user.createTime >= :startTime', {
        startTime: query.startTime,
      });
    }
    if (query.endTime) {
      builder.andWhere('user.createTime <= :endTime', {
        endTime: query.endTime,
      });
    }

    const [users, total] = await builder
      .orderBy('user.createTime', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: users.map((user) => this.serializeUserForList(user)),
      total,
    };
  }

  /**
   * 创建 Admin 身份权限对象或配置。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   */
  async createUser(data: AdminUserInput) {
    await this.ensureUsernameAvailable(String(data.username || ''));

    const user = this.userRepository.create({
      deptId: data.deptId || null,
      homePath: data.homePath || DEFAULT_ADMIN_HOME_PATH,
      password: data.password || '123456',
      realName: data.realName,
      status: data.status ?? 1,
      timezone: data.timezone || 'Asia/Shanghai',
      username: data.username,
    });
    user.roles = await this.findRolesByIds(data.roleIds || []);
    await this.userRepository.save(user);
    return null;
  }

  /**
   * 更新User。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   */
  async updateUser(id: string, data: AdminUserInput) {
    const user = await this.userRepository.findOne({
      relations: ['roles'],
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throwVbenError('用户不存在', HttpStatus.BAD_REQUEST);

    if (data.username !== undefined && data.username !== user.username) {
      await this.ensureUsernameAvailable(data.username, id);
      user.username = data.username;
    }
    if (data.password) user.password = data.password;
    if (data.deptId !== undefined) user.deptId = data.deptId || null;
    if (data.realName !== undefined) user.realName = data.realName;
    if (data.homePath !== undefined) user.homePath = data.homePath;
    if (data.timezone !== undefined) user.timezone = data.timezone;
    if (data.status !== undefined) user.status = data.status;
    if (data.roleIds) user.roles = await this.findRolesByIds(data.roleIds);

    await this.userRepository.save(user);
    return null;
  }

  /**
   * 删除User。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param currentUserId - 用户 ID；定位本次读取、更新、删除或关联的用户。
   */
  async deleteUser(id: string, currentUserId?: string) {
    const user = await this.userRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throwVbenError('用户不存在', HttpStatus.BAD_REQUEST);
    if (id === currentUserId) {
      throwVbenError('不能删除当前登录用户', HttpStatus.BAD_REQUEST);
    }
    if (
      user.id === BUILTIN_ADMIN_USER_ID ||
      user.username === 'admin' ||
      user.username === 'kwitsukasa'
    ) {
      throwVbenError('不能删除内置管理员账号', HttpStatus.BAD_REQUEST);
    }

    await this.userRepository.update(
      { id },
      {
        isDeleted: true,
      },
    );
    return null;
  }

  /**
   * 更新Current Profile。
   * @param userId - 用户 ID；定位本次读取、更新、删除或关联的用户。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
   */
  async updateCurrentProfile(userId: string, data: AdminUserInput) {
    const user = await this.findActiveUser(userId);

    if (data.realName !== undefined) {
      const realName = String(data.realName || '').trim();
      if (!realName) throwVbenError('姓名不能为空', HttpStatus.BAD_REQUEST);
      user.realName = realName;
    }
    if (data.homePath !== undefined) {
      user.homePath =
        String(data.homePath || '').trim() || DEFAULT_ADMIN_HOME_PATH;
    }
    if (data.avatar !== undefined) {
      user.avatar = String(data.avatar || '').trim();
    }

    await this.userRepository.save(user);
    return this.findActiveUser(userId);
  }

  /**
   * 序列化User。
   * @param user - user 输入；使用 `avatar`、`homePath`、`id`、`realName` 字段生成结果。
   */
  serializeUser(user: AdminUser) {
    return {
      avatar: user.avatar || '',
      homePath: user.homePath,
      id: user.id,
      realName: user.realName,
      roles: (user.roles || [])
        .filter((role) => !role.isDeleted && role.status === 1)
        .map((role) => role.roleCode),
      timezone: user.timezone,
      userId: user.id,
      username: user.username,
    };
  }

  /**
   * 序列化User For List。
   * @param user - user 输入；使用 `roles`、`createTime`、`dept`、`deptId` 字段生成结果。
   */
  private serializeUserForList(user: AdminUser) {
    const activeRoles = (user.roles || []).filter((role) => !role.isDeleted);
    return {
      createTime: user.createTime,
      dept: user.dept
        ? {
            id: user.dept.id,
            name: user.dept.name,
          }
        : null,
      deptId: user.deptId,
      deptName: user.dept?.name || '',
      homePath: user.homePath,
      id: user.id,
      avatar: user.avatar,
      realName: user.realName,
      roleIds: activeRoles.map((role) => role.id),
      roleNames: activeRoles.map((role) => role.name),
      roles: activeRoles.map((role) => ({
        id: role.id,
        name: role.name,
        roleCode: role.roleCode,
        status: role.status,
      })),
      status: user.status,
      timezone: user.timezone,
      updateTime: user.updateTime,
      username: user.username,
    };
  }

  /**
   * 查询 Admin 身份权限数据。
   * @param ids - Admin ID 列表；限定本次批量读取、渲染或关联的Admin范围。
   */
  private async findRolesByIds(ids: string[]) {
    const normalizedIds = ids.map((id) => String(id)).filter(Boolean);
    if (!normalizedIds.length) return [];
    return this.roleRepository.find({
      where: normalizedIds.map((id) => ({
        id,
        isDeleted: false,
      })),
    });
  }

  /**
   * 执行 Admin 身份权限流程。
   * @param deptId - Admin ID；定位本次读取、更新、删除或关联的Admin。
   */
  private async collectDeptIds(deptId: string) {
    if (deptId === '0') return ['0'];

    const depts = await this.deptRepository.find({
      where: {
        isDeleted: false,
      },
    });
    const result = new Set<string>([deptId]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const dept of depts) {
        if (result.has(String(dept.pid)) && !result.has(dept.id)) {
          result.add(dept.id);
          changed = true;
        }
      }
    }

    return Array.from(result);
  }

  /**
   * 查询 Admin 身份权限数据。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  private async findActiveUser(id: string) {
    const user = await this.userRepository.findOne({
      relations: ['roles', 'dept'],
      where: {
        id,
        isDeleted: false,
      },
    });

    if (!user) throwVbenError('用户不存在', HttpStatus.BAD_REQUEST);
    return user;
  }

  /**
   * 确保Username Available。
   * @param username - username 输入；生成规范化文本。
   * @param ignoreId - Admin ID；定位本次读取、更新、删除或关联的Admin。
   */
  private async ensureUsernameAvailable(username: string, ignoreId?: string) {
    if (!username.trim()) {
      throwVbenError('用户名不能为空', HttpStatus.BAD_REQUEST);
    }

    const where = ignoreId
      ? {
          id: Not(ignoreId),
          username,
        }
      : {
          username,
        };
    const existing = await this.userRepository.findOne({ where });
    if (existing) {
      throwVbenError('用户名已存在', HttpStatus.BAD_REQUEST);
    }
  }
}
