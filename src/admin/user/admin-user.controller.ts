import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('Admin - 用户管理')
@Controller('user')
@UseGuards(JwtAuthGuard)
export class AdminUserController {
  constructor(private readonly userService: AdminUserService) {}

  @Get('info')
  @ApiOperation({ summary: '获取当前用户信息' })
  async info(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(this.userService.serializeUser(user));
  }
}
