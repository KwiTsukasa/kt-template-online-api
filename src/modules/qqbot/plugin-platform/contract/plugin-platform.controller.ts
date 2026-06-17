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
import { QqbotPluginPlatformService } from '../application/plugin-platform.service';

@ApiTags('QQBot - 插件平台')
@Controller('qqbot/plugin-platform')
@UseGuards(JwtAuthGuard)
export class QqbotPluginPlatformController {
  /**
   * 初始化 QqbotPluginPlatformController 实例。
   * @param service - service 输入；影响 constructor 的返回值。
   */
  constructor(private readonly service: QqbotPluginPlatformService) {}

  /**
   * 插件安装列表。
   */
  @Get('installations')
  @ApiOperation({ summary: '插件安装列表' })
  async installations() {
    return vbenSuccess(await this.service.listInstallations());
  }

  /**
   * 插件平台能力汇总。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  @Get('capabilities')
  @ApiOperation({ summary: '插件平台能力汇总' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async capabilities(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listCapabilities(pluginId));
  }

  /**
   * 插件平台能力列表。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  @Get('operations/list')
  @ApiOperation({ summary: '插件平台能力列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async operationsList(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listOperations(pluginId));
  }

  /**
   * 插件平台能力分页。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
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
   * 插件平台事件处理器列表。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  @Get('event-handlers')
  @ApiOperation({ summary: '插件平台事件处理器列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async eventHandlers(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listEventHandlers(pluginId));
  }

  /**
   * 校验插件 manifest。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '校验插件 manifest' })
  async validate(@Body() body: { manifest?: unknown }) {
    return vbenSuccess(this.service.validateManifest(body));
  }

  /**
   * 上传插件包。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('upload')
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
   * 安装插件包。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('install')
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
   * 本地安装插件包。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('install-local')
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
   * 启用插件。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件' })
  async enable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.enableInstallation(body));
  }

  /**
   * 禁用插件。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用插件' })
  async disable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.disableInstallation(body));
  }

  /**
   * 升级插件。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '升级插件' })
  async upgrade(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.upgradeInstallation(body));
  }

  /**
   * 卸载插件。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('uninstall')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '卸载插件' })
  async uninstall(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.uninstallInstallation(body));
  }

  /**
   * 更新插件配置。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件配置' })
  async config(
    @Body() body: { configKey?: string; pluginId?: string; value?: unknown },
  ) {
    return vbenSuccess(await this.service.updateConfig(body));
  }

  /**
   * 插件运行事件列表。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
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

  /**
   * 插件账号绑定列表。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  @Get('account-bindings')
  @ApiOperation({ summary: '插件账号绑定列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async accountBindings(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listAccountBindings(pluginId));
  }
}
