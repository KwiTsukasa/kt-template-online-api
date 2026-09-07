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
  BotPermissionBodyDto,
  BotPermissionConfigDto,
  BotPermissionQueryDto,
  BotPermissionOptionsQueryDto,
  BotPermissionUpdateDto,
} from './bot-permission.dto';
import { BotPermissionService } from '../../application/permission/bot-permission.service';
import { BotPermissionOptionsService } from '../../application/permission/bot-permission-options.service';

@ApiTags('Bot - 权限名单')
@Controller('bot/permission')
@UseGuards(JwtAuthGuard)
export class BotPermissionController {
  constructor(
    private readonly permissionService: BotPermissionService,
    private readonly optionsService: BotPermissionOptionsService,
  ) {}

  /**
   * 返回权限名单的 Bot 账号及按账号、群或频道隔离的下拉候选。
   * @param query - 选定的 Bot 账号、目标类型和群或频道。
   * @returns 账号、目标与精确用户候选的 Vben 响应。
   */
  @Get('options')
  @ApiOperation({ summary: 'Bot 权限名单级联候选' })
  async options(@Query() query: BotPermissionOptionsQueryDto) {
    return vbenSuccess(await this.optionsService.list(query));
  }

  /**
   * 根据当前运行态处理配置；从 `permissionService.getConfig` 读取配置。
   * @returns 配置。
   */
  @Get('config')
  @ApiOperation({ summary: 'Bot 权限名单配置' })
  async config() {
    return vbenSuccess(await this.permissionService.getConfig());
  }

  /**
   * 将 Bot 权限名单配置交给服务校验并持久化，再封装为 Vben 成功响应。
   * @param body - 待更新的 Bot 权限名单与默认权限配置。
   * @returns 返回持久化后的权限配置及 Vben 成功响应外壳。
   */
  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '保存 Bot 权限名单配置' })
  async updateConfig(@Body() body: BotPermissionConfigDto) {
    return vbenSuccess(await this.permissionService.updateConfig(body));
  }

  /**
   * 按查询条件读取 Bot 白名单分页，并封装为 Vben 成功响应。
   * @param query - 限定白名单记录筛选、排序与分页范围的查询条件。
   * @returns 白名单记录。
   */
  @Get('allowlist')
  @ApiOperation({ summary: 'Bot 白名单分页' })
  async allowlist(@Query() query: BotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('allowlist', query));
  }

  /**
   * 根据`body`更新白名单记录。
   * @param body - 用于白名单记录的结构化输入。
   * @returns 白名单记录。
   */
  @Post('allowlist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 Bot 白名单' })
  async saveAllowlist(@Body() body: BotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('allowlist', body));
  }

  /**
   * 根据`body`更新白名单记录。
   * @param body - 用于白名单记录的结构化输入。
   * @returns 白名单记录。
   */
  @Post('allowlist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 Bot 白名单' })
  async updateAllowlist(@Body() body: BotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('allowlist', body));
  }

  /**
   * 按记录标识删除 Bot 白名单项，并返回统一成功响应。
   * @param id - 决定Bot 白名单内容、边界或目标的 `id` 值。
   * @returns Bot 白名单。
   */
  @Post('allowlist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 Bot 白名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteAllowlist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('allowlist', id));
  }

  /**
   * 按查询条件读取 Bot 黑名单分页，并封装为 Vben 成功响应。
   * @param query - 限定黑名单记录筛选、排序与分页范围的查询条件。
   * @returns 黑名单记录。
   */
  @Get('blocklist')
  @ApiOperation({ summary: 'Bot 黑名单分页' })
  async blocklist(@Query() query: BotPermissionQueryDto) {
    return vbenSuccess(await this.permissionService.page('blocklist', query));
  }

  /**
   * 根据`body`更新黑名单记录。
   * @param body - 用于黑名单记录的结构化输入。
   * @returns 黑名单记录。
   */
  @Post('blocklist/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增 Bot 黑名单' })
  async saveBlocklist(@Body() body: BotPermissionBodyDto) {
    return vbenSuccess(await this.permissionService.save('blocklist', body));
  }

  /**
   * 根据`body`更新黑名单记录。
   * @param body - 用于黑名单记录的结构化输入。
   * @returns 黑名单记录。
   */
  @Post('blocklist/update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '编辑 Bot 黑名单' })
  async updateBlocklist(@Body() body: BotPermissionUpdateDto) {
    return vbenSuccess(await this.permissionService.update('blocklist', body));
  }

  /**
   * 按记录标识删除 Bot 黑名单项，并返回统一成功响应。
   * @param id - 决定Bot 黑名单内容、边界或目标的 `id` 值。
   * @returns Bot 黑名单。
   */
  @Post('blocklist/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除 Bot 黑名单' })
  @ApiQuery({ name: 'id', type: String })
  async deleteBlocklist(@Query('id') id: string) {
    return vbenSuccess(await this.permissionService.remove('blocklist', id));
  }
}
