import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('admin-user')
@Controller('user')
@UseGuards(JwtAuthGuard)
export class AdminUserController {
  constructor(private readonly userService: AdminUserService) {}

  @Get('info')
  async info(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(this.userService.serializeUser(user));
  }
}
