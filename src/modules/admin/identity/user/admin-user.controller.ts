import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('Admin - 用户管理')
@Controller('user')
@UseGuards(JwtAuthGuard)
export class AdminUserController {
  constructor(private readonly userService: AdminUserService) {}

  /**
   * 获取当前用户信息。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 当前用户信息。
   */
  @Get('info')
  @ApiOperation({ summary: '获取当前用户信息' })
  async info(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(this.userService.serializeUser(user));
  }

  /**
   * 针对当前用户基础资料。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param body - 用于针对当前用户基础资料的结构化输入。
   * @returns 针对当前用户基础资料。
   */
  @Put('profile')
  @ApiOperation({ summary: '更新当前用户基础资料' })
  async updateProfile(
    @CurrentAdminUser() user: AdminUser,
    @Body() body: Record<string, any>,
  ) {
    const updated = await this.userService.updateCurrentProfile(user.id, body);
    return vbenSuccess(this.userService.serializeUser(updated));
  }
}
