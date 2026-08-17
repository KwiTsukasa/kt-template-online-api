import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminDept } from '../dept/admin-dept.entity';
import { AdminRole } from '../role/admin-role.entity';
import { AdminPasswordHashService } from '@/modules/admin/identity/auth/application/admin-password-hash.service';
import { AdminUser } from './admin-user.entity';
import type {
  AdminUserInput,
  AdminUserListQuery,
} from '../../contract/admin.types';

const BUILTIN_ADMIN_USER_ID = '2041700000000000002';
const DEFAULT_ADMIN_HOME_PATH = '/analytics';

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminDept)
    private readonly deptRepository: Repository<AdminDept>,
    private readonly passwordHashService: AdminPasswordHashService,
  ) {}

  /**
   * 通过 `where` 筛选匹配数据。
   * @param query - 限定用户筛选、排序与分页范围的查询条件，包含 `page`、`pageSize`、`id`、`username` 字段。
   * @returns 包含 `items`、`total` 字段的用户。
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
   * 通过 `ensureUsernameAvailable` 强制满足前置条件。
   * @param data - 用于用户的领域对象，包含 `username`、`password`、`deptId`、`homePath` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生用户。
   */
  async createUser(data: AdminUserInput) {
    await this.ensureUsernameAvailable(String(data.username || ''));
    const password = await this.passwordHashService.hashPassword(data.password);

    const user = this.userRepository.create({
      deptId: data.deptId || null,
      homePath: data.homePath || DEFAULT_ADMIN_HOME_PATH,
      password,
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
   * 根据`id`、`data`更新用户；把变更持久化到当前存储（`userRepository.save`）。
   * @param id - 决定用户内容、边界或目标的 `id` 值。
   * @param data - 用于用户的领域对象，包含 `username`、`password`、`deptId`、`realName` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生用户。
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
    if (data.password) {
      user.password = await this.passwordHashService.hashPassword(
        data.password,
      );
    }
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
   * 根据`id`、`password`处理重置用户密码；把变更持久化到当前存储（`userRepository.save`）。
   * @param id - 决定重置用户密码内容、边界或目标的 `id` 值。
   * @param password - 决定重置用户密码内容、边界或目标的 `password` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 固定为 `null`，表示当前入口不会产生重置用户密码。
   */
  async resetUserPassword(id: string, password?: string) {
    const user = await this.userRepository.findOne({
      where: {
        id,
        isDeleted: false,
      },
    });
    if (!user) throwVbenError('用户不存在', HttpStatus.BAD_REQUEST);

    user.password = await this.passwordHashService.hashPassword(password);
    await this.userRepository.save(user);
    return null;
  }

  /**
   * 按`id`、`currentUserId`移除用户；把变更持久化到当前存储（`userRepository.update`）。
   * @param id - 决定用户内容、边界或目标的 `id` 值。
   * @param currentUserId - 用于精确定位用户的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 固定为 `null`，表示当前入口不会产生用户。
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
   * 根据`userId`、`data`更新资料；把变更持久化到当前存储（`userRepository.save`）。
   * @param userId - 用于精确定位用户的标识。
   * @param data - 用于资料的领域对象，包含 `realName`、`homePath`、`avatar` 字段。
   * @returns 资料。
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
   * 将管理员实体投影为当前登录用户资料，仅保留未删除且已启用角色的角色编码。
   * @param user - 当前管理员实体；应已加载角色关系，缺少头像或角色时分别按空字符串和空数组处理。
   * @returns 返回登录态需要的用户资料与有效角色编码列表。
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
   * 将管理员实体投影为列表行，过滤已软删除角色并展开部门与角色展示字段。
   * @param user - 待展示的管理员实体；未加载部门或角色时分别按 `null` 和空数组处理。
   * @returns 返回包含部门摘要、有效角色列表及用户基本字段的管理端列表行。
   */
  private serializeUserForList(user: AdminUser) {
    const activeRoles = (user.roles || []).filter((role) => !role.isDeleted);
    return {
      createTime: user.createTime,
      dept: (() => {
        if (user.dept) {
          return {
            id: user.dept.id,
            name: user.dept.name,
          };
        }
        return null;
      })(),
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
   * 通过 `filter` 筛选匹配数据。
   * @param ids - 决定Roles标识集合内容、边界或目标的 `ids` 值。
   * @returns Roles标识集合。
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
   * 根据`deptId`处理部门标识集合。
   * @param deptId - 用于精确定位部门的标识。
   * @returns 部门标识集合。
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
   * 按`id`读取启用状态用户；从 `userRepository.findOne` 读取启用状态用户。
   * @param id - 决定启用状态用户内容、边界或目标的 `id` 值。
   * @returns 启用状态用户。
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
   * 确保UsernameAvailable存在且保持一致；缺失时根据`username`、`ignoreId`补齐对应状态；从 `userRepository.findOne` 读取UsernameAvailable。
   * @param username - 决定是否启用“username”分支的布尔选项。
   * @param ignoreId - 用于精确定位ignore的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async ensureUsernameAvailable(username: string, ignoreId?: string) {
    if (!username.trim()) {
      throwVbenError('用户名不能为空', HttpStatus.BAD_REQUEST);
    }

    const where = (() => {
      if (ignoreId) {
        return {
          id: Not(ignoreId),
          username,
        };
      }
      return {
          username,
        };
    })();
    const existing = await this.userRepository.findOne({ where });
    if (existing) {
      throwVbenError('用户名已存在', HttpStatus.BAD_REQUEST);
    }
  }
}
