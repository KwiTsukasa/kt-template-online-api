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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
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
  constructor(private readonly permissionService: QqbotPermissionService) {}

  /**
   * 根据当前运行态处理配置；从 `permissionService.getConfig` 读取配置。
   * @returns 配置。
   */
  @Get('config')
  @ApiOperation({ summary: 'QQBot 权限名单配置' })
  async config() {
    return vbenSuccess(await this.permissionService.getConfig());
  }

  /**
   * 将 QQBot 权限名单配置交给服务校验并持久化，再封装为 Vben 成功响应。
   * @param body - 待更新的 QQBot 权限名单与默认权限配置。
   * @returns 返回持久化后的权限配置及 Vben 成功响应外壳。
   */
  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存 QQBot 权限名单配置' })
  async updateConfig(@Body() body: QqbotPermissionConfigDto) {
    return vbenSuccess(await this.permissionService.updateConfig(body));
  }

  /**
   * 按查询条件读取 QQBot 白名单分页，并封装为 Vben 成功响应。
   * @param query - 限定白名单记录筛选、排序与分页范围的查询条件。
   * @returns 白名单记录。
   */
  @Get('allowlist')
  @ApiOperation({ summary: 'QQBot 白名单分页' })
  async allowlist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('allowlist', query));
  }

  /**
   * 根据`body`更新白名单记录。
   * @param body - 用于白名单记录的结构化输入。
   * @returns 白名单记录。
   */
  @Post('allowlist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 白名单' })
  async saveAllowlist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('allowlist', body));
  }

  /**
   * 根据`body`更新白名单记录。
   * @param body - 用于白名单记录的结构化输入。
   * @returns 白名单记录。
   */
  @Post('allowlist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 白名单' })
  async updateAllowlist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('allowlist', body));
  }

  /**
   * 按记录标识删除 QQBot 白名单项，并返回统一成功响应。
   * @param id - 决定QQBot 白名单内容、边界或目标的 `id` 值。
   * @returns QQBot 白名单。
   */
  @Post('allowlist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 白名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteAllowlist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('allowlist', id));
  }

  /**
   * 按查询条件读取 QQBot 黑名单分页，并封装为 Vben 成功响应。
   * @param query - 限定黑名单记录筛选、排序与分页范围的查询条件。
   * @returns 黑名单记录。
   */
  @Get('blocklist')
  @ApiOperation({ summary: 'QQBot 黑名单分页' })
  async blocklist(@Query() query: QqbotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('blocklist', query));
  }

  /**
   * 根据`body`更新黑名单记录。
   * @param body - 用于黑名单记录的结构化输入。
   * @returns 黑名单记录。
   */
  @Post('blocklist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 QQBot 黑名单' })
  async saveBlocklist(@Body() body: QqbotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('blocklist', body));
  }

  /**
   * 根据`body`更新黑名单记录。
   * @param body - 用于黑名单记录的结构化输入。
   * @returns 黑名单记录。
   */
  @Post('blocklist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 QQBot 黑名单' })
  async updateBlocklist(@Body() body: QqbotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('blocklist', body));
  }

  /**
   * 按记录标识删除 QQBot 黑名单项，并返回统一成功响应。
   * @param id - 决定QQBot 黑名单内容、边界或目标的 `id` 值。
   * @returns QQBot 黑名单。
   */
  @Post('blocklist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 QQBot 黑名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteBlocklist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('blocklist', id));
  }
}
