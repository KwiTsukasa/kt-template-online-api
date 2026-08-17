import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { AdminUser } from '../../identity/user/admin-user.entity';

@Injectable()
export class AdminTimezoneService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
  ) {}

  /**
   * 读取用户保存的时区，并在未设置或为空时使用 `Asia/Shanghai`。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 规范化后的时区；主值为空时采用 `'Asia/Shanghai'` 兜底。
   */
  async getTimezone(user: AdminUser) {
    return user.timezone || 'Asia/Shanghai';
  }

  /**
   * 根据`user`、`timezone`、`allowed`更新时区；把变更持久化到当前存储（`userRepository.update`）。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param timezone - 决定时区内容、边界或目标的 `timezone` 值。
   * @param allowed - 决定是否启用“许可范围”分支的布尔选项。
   * @returns 时区。
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
