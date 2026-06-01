import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotPermissionBodyDto,
  QqbotPermissionConfigDto,
  QqbotPermissionQueryDto,
  QqbotPermissionUpdateDto,
} from './qqbot-permission.dto';
import { QqbotPermissionService } from './qqbot-permission.service';

@ApiTags('qqbot-permission')
@Controller('qqbot/permission')
@UseGuards(JwtAuthGuard)
export class QqbotPermissionController {
  constructor(private readonly permissionService: QqbotPermissionService) {}

  @Get('config')
  @ApiOperation({ summary: 'QQBot 权限名单配置' })
  async config() {
    return vbenSuccess(await this.permissionService.getConfig());
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存 QQBot 权限名单配置' })
  async updateConfig(@Body() body: QqbotPermissionConfigDto) {
    return vbenSuccess(await this.permissionService.updateConfig(body));
  }

  @Get('allowlist')
  @ApiOperation({ summary: 'QQBot 白名单分页' })
  async allowlist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('allowlist', query));
  }

  @Post('allowlist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 白名单' })
  async saveAllowlist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('allowlist', body));
  }

  @Post('allowlist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 白名单' })
  async updateAllowlist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('allowlist', body));
  }

  @Post('allowlist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 白名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteAllowlist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('allowlist', id));
  }

  @Get('blocklist')
  @ApiOperation({ summary: 'QQBot 黑名单分页' })
  async blocklist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('blocklist', query));
  }

  @Post('blocklist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 黑名单' })
  async saveBlocklist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('blocklist', body));
  }

  @Post('blocklist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 黑名单' })
  async updateBlocklist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('blocklist', body));
  }

  @Post('blocklist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 黑名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteBlocklist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('blocklist', id));
  }
}
