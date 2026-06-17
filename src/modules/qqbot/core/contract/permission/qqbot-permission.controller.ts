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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import {
  QqbotPermissionBodyDto,
  QqbotPermissionConfigDto,
  QqbotPermissionQueryDto,
  QqbotPermissionUpdateDto,
} from './qqbot-permission.dto';
import { QqbotPermissionService } from '../../application/permission/qqbot-permission.service';

@ApiTags('QQBot - 权限名单')
@Controller('qqbot/permission')
@UseGuards(JwtAuthGuard)
export class QqbotPermissionController {
  /**
   * 初始化 QqbotPermissionController 实例。
   * @param permissionService - permissionService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly permissionService: QqbotPermissionService) {}

  /**
   * QQBot 权限名单配置。
   */
  @Get('config')
  @ApiOperation({ summary: 'QQBot 权限名单配置' })
  async config() {
    return vbenSuccess(await this.permissionService.getConfig());
  }

  /**
   * 保存 QQBot 权限名单配置。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存 QQBot 权限名单配置' })
  async updateConfig(@Body() body: QqbotPermissionConfigDto) {
    return vbenSuccess(await this.permissionService.updateConfig(body));
  }

  /**
   * QQBot 白名单分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('allowlist')
  @ApiOperation({ summary: 'QQBot 白名单分页' })
  async allowlist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('allowlist', query));
  }

  /**
   * 新增 QQBot 白名单。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('allowlist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 白名单' })
  async saveAllowlist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('allowlist', body));
  }

  /**
   * 编辑 QQBot 白名单。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('allowlist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 白名单' })
  async updateAllowlist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('allowlist', body));
  }

  /**
   * 删除 QQBot 白名单。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  @Post('allowlist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 白名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteAllowlist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('allowlist', id));
  }

  /**
   * QQBot 黑名单分页。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  @Get('blocklist')
  @ApiOperation({ summary: 'QQBot 黑名单分页' })
  async blocklist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('blocklist', query));
  }

  /**
   * 新增 QQBot 黑名单。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('blocklist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 黑名单' })
  async saveBlocklist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('blocklist', body));
  }

  /**
   * 编辑 QQBot 黑名单。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  @Post('blocklist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 黑名单' })
  async updateBlocklist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('blocklist', body));
  }

  /**
   * 删除 QQBot 黑名单。
   * @param id - QQBot记录 ID；定位本次读取、更新、删除或关联的QQBot记录。
   */
  @Post('blocklist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 黑名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteBlocklist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('blocklist', id));
  }
}
