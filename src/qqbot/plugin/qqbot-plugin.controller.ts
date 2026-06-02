import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/admin/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotPluginRegistryService } from './qqbot-plugin-registry.service';

@ApiTags('qqbot-plugin')
@Controller('qqbot/plugin')
@UseGuards(JwtAuthGuard)
export class QqbotPluginController {
  constructor(private readonly pluginRegistry: QqbotPluginRegistryService) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 插件列表' })
  async list() {
    return vbenSuccess(this.pluginRegistry.listPlugins());
  }

  @Get('operation/list')
  @ApiOperation({ summary: 'QQBot 插件能力列表' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  async operationList(@Query('pluginKey') pluginKey?: string) {
    return vbenSuccess(this.pluginRegistry.listOperations(pluginKey));
  }

  @Get('health')
  @ApiOperation({ summary: 'QQBot 插件健康检查' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  async health(@Query('pluginKey') pluginKey?: string) {
    return vbenSuccess(await this.pluginRegistry.health(pluginKey));
  }
}
