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
  constructor(private readonly service: QqbotPluginPlatformService) {}

  @Get('installations')
  @ApiOperation({ summary: '插件安装列表' })
  async installations() {
    return vbenSuccess(await this.service.listInstallations());
  }

  @Get('capabilities')
  @ApiOperation({ summary: '插件平台能力汇总' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async capabilities(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listCapabilities(pluginId));
  }

  @Get('operations/list')
  @ApiOperation({ summary: '插件平台能力列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async operationsList(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listOperations(pluginId));
  }

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

  @Get('event-handlers')
  @ApiOperation({ summary: '插件平台事件处理器列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async eventHandlers(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listEventHandlers(pluginId));
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '校验插件 manifest' })
  async validate(@Body() body: { manifest?: unknown }) {
    return vbenSuccess(this.service.validateManifest(body));
  }

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

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件' })
  async enable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.enableInstallation(body));
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用插件' })
  async disable(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.disableInstallation(body));
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '升级插件' })
  async upgrade(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.upgradeInstallation(body));
  }

  @Post('uninstall')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '卸载插件' })
  async uninstall(@Body() body: { id?: string }) {
    return vbenSuccess(await this.service.uninstallInstallation(body));
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件配置' })
  async config(
    @Body() body: { configKey?: string; pluginId?: string; value?: unknown },
  ) {
    return vbenSuccess(await this.service.updateConfig(body));
  }

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

  @Get('account-bindings')
  @ApiOperation({ summary: '插件账号绑定列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async accountBindings(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listAccountBindings(pluginId));
  }
}
