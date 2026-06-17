import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('Admin - 用户管理')
@Controller('user')
@UseGuards(JwtAuthGuard)
export class AdminUserController {
  /**
   * 初始化 AdminUserController 实例。
   * @param userService - userService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly userService: AdminUserService) {}

  /**
   * 获取当前用户信息。
   * @param user - user 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   */
  @Get('info')
  @ApiOperation({ summary: '获取当前用户信息' })
  async info(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(this.userService.serializeUser(user));
  }

  /**
   * 更新当前用户基础资料。
   * @param user - user 输入；使用 `id` 字段生成结果。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
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
