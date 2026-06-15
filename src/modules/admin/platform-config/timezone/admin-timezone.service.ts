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

  async getTimezone(user: AdminUser) {
    return user.timezone || 'Asia/Shanghai';
  }

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
