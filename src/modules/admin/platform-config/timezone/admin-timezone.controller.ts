import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
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
  constructor(private readonly timezoneService: AdminTimezoneService) {}

  /**
   * 按当前运行态读取时区选项。
   * @returns 时区选项。
   */
  @Get('getTimezoneOptions')
  @ApiOperation({ summary: '获取时区选项' })
  getOptions() {
    return vbenSuccess(TIMEZONE_OPTIONS);
  }

  /**
   * 获取当前用户时区。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 当前用户时区。
   */
  @Get('getTimezone')
  @ApiOperation({ summary: '获取当前用户时区' })
  async getTimezone(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.timezoneService.getTimezone(user));
  }

  /**
   * 针对设置当前用户时区。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @param body - 用于针对设置当前用户时区的结构化输入，包含 `timezone` 字段。
   * @returns 针对设置当前用户时区。
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
