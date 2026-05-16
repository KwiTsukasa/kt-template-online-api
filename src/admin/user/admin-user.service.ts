import { Injectable } from '@nestjs/common';
import { AdminUser } from './admin-user.entity';

@Injectable()
export class AdminUserService {
  serializeUser(user: AdminUser) {
    return {
      homePath: user.homePath,
      id: user.id,
      realName: user.realName,
      roles: (user.roles || [])
        .filter((role) => !role.isDeleted && role.status === 1)
        .map((role) => role.roleCode),
      username: user.username,
    };
  }
}
