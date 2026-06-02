import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from '../user/admin-user.entity';
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

  @Get('getTimezoneOptions')
  getOptions() {
    return vbenSuccess(TIMEZONE_OPTIONS);
  }

  @Get('getTimezone')
  async getTimezone(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.timezoneService.getTimezone(user));
  }

  @Post('setTimezone')
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
