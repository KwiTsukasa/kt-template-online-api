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
import { PluginPlatformService } from '../application/plugin-platform.service';
import {
  PluginPlatformPermission,
  PluginPlatformPermissionGuard,
} from './plugin-platform-permission.guard';

@ApiTags('Bot - 插件平台')
@Controller('plugin-platform')
@UseGuards(JwtAuthGuard, PluginPlatformPermissionGuard)
@PluginPlatformPermission('PluginPlatform:Plugin:List')
export class PluginPlatformController {
  constructor(private readonly service: PluginPlatformService) {}

  /**
   * 读取插件安装记录列表，并封装为 Vben 成功响应。
   * @returns 安装记录列表。
   */
  @Get('installations')
  @ApiOperation({ summary: '插件安装列表' })
  async installations() {
    return vbenSuccess(await this.service.listInstallations());
  }

  /**
   * 根据当前平台状态返回插件平台能力汇总。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 根据当前平台状态返回插件平台能力汇总。
   */
  @Get('capabilities')
  @ApiOperation({ summary: '插件平台能力汇总' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async capabilities(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listCapabilities(pluginId));
  }

  /**
   * 根据`pluginId`处理针对插件平台能力列表；从 `service.listOperations` 读取针对插件平台能力列表。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 针对插件平台能力列表。
   */
  @Get('operations/list')
  @ApiOperation({ summary: '插件平台能力列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async operationsList(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listOperations(pluginId));
  }

  /**
   * 根据`query`处理针对插件平台能力分页。
   * @param query - 限定针对插件平台能力分页筛选、排序与分页范围的查询条件。
   * @returns 针对插件平台能力分页。
   */
  @Get('operations/page')
  @ApiOperation({ summary: '插件平台能力分页' })
  @ApiQuery({ name: 'pageNo', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async operationsPage(
    @Query()
    query: {
      pageNo?: number | string;
      pageSize?: number | string;
      pluginId?: string;
    },
  ) {
    return vbenSuccess(await this.service.pageOperations(query));
  }

  /**
   * 根据当前平台状态返回插件平台事件处理器列表。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 事件处理器列表。
   */
  @Get('event-handlers')
  @ApiOperation({ summary: '插件平台事件处理器列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async eventHandlers(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listEventHandlers(pluginId));
  }

  /**
   * 校验`body`是否满足插件 manifest约束，并拒绝不合法输入；先通过 `service.validateManifest` 校验输入边界。
   * @param body - 用于插件 manifest的结构化输入。
   * @returns 插件 manifest。
   */
  @Post('validate')
  @PluginPlatformPermission('PluginPlatform:Plugin:Install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '校验插件 manifest' })
  async validate(@Body() body: { manifest?: unknown }) {
    return vbenSuccess(this.service.validateManifest(body));
  }

  /**
   * 根据`body`处理上传插件包。
   * @param body - 用于上传插件包的结构化输入。
   * @returns 上传插件包。
   */
  @Post('upload')
  @PluginPlatformPermission('PluginPlatform:Plugin:Install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '上传插件包' })
  async upload(
    @Body()
    body: {
      manifest?: unknown;
      packageHash?: string;
      packagePath?: string;
    },
  ) {
    return vbenSuccess(this.service.uploadPackage(body));
  }

  /**
   * 根据`body`处理针对插件包。
   * @param body - 用于针对插件包的结构化输入。
   * @returns 针对插件包。
   */
  @Post('install')
  @PluginPlatformPermission('PluginPlatform:Plugin:Install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '安装插件包' })
  async install(
    @Body()
    body: {
      manifest?: unknown;
      packageHash?: string;
      packagePath?: string;
    },
  ) {
    return vbenSuccess(await this.service.installLocal(body));
  }

  /**
   * 根据`body`处理本地安装插件包。
   * @param body - 用于本地安装插件包的结构化输入。
   * @returns 本地安装插件包。
   */
  @Post('install-local')
  @PluginPlatformPermission('PluginPlatform:Plugin:Install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '本地安装插件包' })
  async installLocal(
    @Body()
    body: {
      manifest?: unknown;
      packageHash?: string;
      packagePath?: string;
    },
  ) {
    return vbenSuccess(await this.service.installLocal(body));
  }

  /**
   * 按安装标识启用插件安装，并返回更新后的安装状态。
   * @param body - 用于针对插件的结构化输入。
   * @returns 针对插件。
   */
  @Post('enable')
  @PluginPlatformPermission('PluginPlatform:Plugin:Enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件' })
  async enable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.enableInstallation(body));
  }

  /**
   * 按`body`停止针对插件并清理该入口拥有的运行态资源。
   * @param body - 用于针对插件的结构化输入。
   * @returns 针对插件。
   */
  @Post('disable')
  @PluginPlatformPermission('PluginPlatform:Plugin:Disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用插件' })
  async disable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.disableInstallation(body));
  }

  /**
   * 根据`body`处理升级插件。
   * @param body - 用于升级插件的结构化输入。
   * @returns 升级插件。
   */
  @Post('upgrade')
  @PluginPlatformPermission('PluginPlatform:Plugin:Upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '升级插件' })
  async upgrade(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.upgradeInstallation(body));
  }

  /**
   * 根据`body`处理卸载插件。
   * @param body - 用于卸载插件的结构化输入。
   * @returns 卸载插件。
   */
  @Post('uninstall')
  @PluginPlatformPermission('PluginPlatform:Plugin:Uninstall')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '卸载插件' })
  async uninstall(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.uninstallInstallation(body));
  }

  /**
   * 根据`body`处理针对插件配置。
   * @param body - 用于针对插件配置的结构化输入。
   * @returns 针对插件配置。
   */
  @Post('config')
  @PluginPlatformPermission('PluginPlatform:Plugin:Config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件配置' })
  async config(
    @Body() body: { configKey?: string; pluginId?: string; value?: unknown },
  ) {
    return vbenSuccess(await this.service.updateConfig(body));
  }

  /**
   * 根据当前平台状态返回插件运行事件列表。
   * @param query - 限定根据当前平台状态返回插件运行事件列表筛选、排序与分页范围的查询条件。
   * @returns 根据当前平台状态返回插件运行事件列表。
   */
  @Get('runtime-events')
  @ApiOperation({ summary: '插件运行事件列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  @ApiQuery({ name: 'installationId', required: false, type: String })
  @ApiQuery({ name: 'level', required: false, type: String })
  @ApiQuery({ name: 'eventType', required: false, type: String })
  @ApiQuery({ name: 'startTime', required: false, type: String })
  @ApiQuery({ name: 'endTime', required: false, type: String })
  async runtimeEvents(
    @Query()
    query: {
      endTime?: string;
      eventType?: string;
      installationId?: string;
      level?: 'error' | 'info' | 'warn';
      pluginId?: string;
      startTime?: string;
    },
  ) {
    return vbenSuccess(await this.service.listRuntimeEvents(query));
  }
}
