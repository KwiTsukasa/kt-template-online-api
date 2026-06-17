import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminUser } from '../../identity/user/admin-user.entity';

@Injectable()
export class AdminTimezoneService {
  /**
   * 初始化 AdminTimezoneService 实例。
   * @param userRepository - 用户仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
  ) {}

  /**
   * 查询 Admin 平台配置数据。
   * @param user - user 输入；使用 `timezone` 字段生成结果。
   */
  async getTimezone(user: AdminUser) {
    return user.timezone || 'Asia/Shanghai';
  }

  /**
   * 设置Timezone。
   * @param user - user 输入；使用 `id` 字段生成结果。
   * @param timezone - timezone 输入；驱动 `throwVbenError()` 的 Admin步骤。
   * @param allowed - allowed 输入；计算 Admin布尔判断。
   */
  async setTimezone(user: AdminUser, timezone: string, allowed: string[]) {
    if (!timezone || !allowed.includes(timezone)) {
      throwVbenError('Invalid timezone', HttpStatus.BAD_REQUEST, 'Bad Request');
    }

    await this.userRepository.update(user.id, {
      timezone,
    });
    return {};
  }
}
