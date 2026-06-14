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
import { QqbotPluginPlatformService } from './plugin-platform.service';

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
    return vbenSuccess(this.service.validateManifest(body));
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
    return vbenSuccess(
      await this.service.setInstallationStatus(body, 'enabled'),
    );
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '禁用插件' })
  async disable(@Body() body: { id?: string }) {
    return vbenSuccess(
      await this.service.setInstallationStatus(body, 'disabled'),
    );
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '升级插件' })
  async upgrade(@Body() body: { id?: string }) {
    return vbenSuccess(
      await this.service.setInstallationStatus(body, 'installed'),
    );
  }

  @Post('uninstall')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '卸载插件' })
  async uninstall(@Body() body: { id?: string }) {
    return vbenSuccess(
      await this.service.setInstallationStatus(body, 'uninstalled'),
    );
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
  async runtimeEvents(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listRuntimeEvents(pluginId));
  }

  @Get('account-bindings')
  @ApiOperation({ summary: '插件账号绑定列表' })
  @ApiQuery({ name: 'pluginId', required: false, type: String })
  async accountBindings(@Query('pluginId') pluginId?: string) {
    return vbenSuccess(await this.service.listAccountBindings(pluginId));
  }
}
