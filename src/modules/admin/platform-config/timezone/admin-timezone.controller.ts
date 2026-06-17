import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../../identity/auth/jwt-auth.guard';
import { AdminUser } from '../../identity/user/admin-user.entity';
import { AdminTimezoneService } from './admin-timezone.service';

const TIMEZONE_OPTIONS = [
  { label: 'America/New_York (GMT-5)', value: 'America/New_York' },
  { label: 'Europe/London (GMT+0)', value: 'Europe/London' },
  { label: 'Asia/Shanghai (GMT+8)', value: 'Asia/Shanghai' },
  { label: 'Asia/Tokyo (GMT+9)', value: 'Asia/Tokyo' },
  { label: 'Asia/Seoul (GMT+9)', value: 'Asia/Seoul' },
];

@ApiTags('Admin - 时区')
@Controller('timezone')
@UseGuards(JwtAuthGuard)
export class AdminTimezoneController {
  /**
   * 初始化 AdminTimezoneController 实例。
   * @param timezoneService - timezoneService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly timezoneService: AdminTimezoneService) {}

  /**
   * 获取时区选项。
   */
  @Get('getTimezoneOptions')
  @ApiOperation({ summary: '获取时区选项' })
  getOptions() {
    return vbenSuccess(TIMEZONE_OPTIONS);
  }

  /**
   * 获取当前用户时区。
   * @param user - user 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   */
  @Get('getTimezone')
  @ApiOperation({ summary: '获取当前用户时区' })
  async getTimezone(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.timezoneService.getTimezone(user));
  }

  /**
   * 设置当前用户时区。
   * @param user - user 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Post('setTimezone')
  @ApiOperation({ summary: '设置当前用户时区' })
  async setTimezone(
    @CurrentAdminUser() user: AdminUser,
    @Body() body: { timezone?: string },
  ) {
    return vbenSuccess(
      await this.timezoneService.setTimezone(
        user,
        body.timezone,
        TIMEZONE_OPTIONS.map((option) => option.value),
      ),
    );
  }
}
