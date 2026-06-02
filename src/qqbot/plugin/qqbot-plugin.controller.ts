import {
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
import { QqbotEventPluginRegistryService } from './qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from './qqbot-plugin-registry.service';
import type { QqbotPluginTriggerMode } from './qqbot-plugin.types';

@ApiTags('qqbot-plugin')
@Controller('qqbot/plugin')
@UseGuards(JwtAuthGuard)
export class QqbotPluginController {
  constructor(
    private readonly eventPluginRegistry: QqbotEventPluginRegistryService,
    private readonly pluginRegistry: QqbotPluginRegistryService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: 'QQBot 插件列表' })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async list(@Query('triggerMode') triggerMode?: QqbotPluginTriggerMode) {
    return vbenSuccess([
      ...(this.includesTriggerMode('command', triggerMode)
        ? this.pluginRegistry.listPlugins()
        : []),
      ...(this.includesTriggerMode('event', triggerMode)
        ? this.eventPluginRegistry.listDefinitions().map((definition) => ({
            description: definition.description,
            key: definition.key,
            name: definition.name,
            operationCount: 1,
            triggerMode: 'event' as const,
            version: definition.version,
          }))
        : []),
    ]);
  }

  @Get('operation/list')
  @ApiOperation({ summary: 'QQBot 插件能力列表' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async operationList(
    @Query('pluginKey') pluginKey?: string,
    @Query('triggerMode') triggerMode?: QqbotPluginTriggerMode,
  ) {
    return vbenSuccess([
      ...(this.includesTriggerMode('command', triggerMode)
        ? this.pluginRegistry.listOperations(pluginKey)
        : []),
      ...(this.includesTriggerMode('event', triggerMode)
        ? this.eventPluginRegistry.listOperations(pluginKey)
        : []),
    ]);
  }

  @Get('health')
  @ApiOperation({ summary: 'QQBot 插件健康检查' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async health(
    @Query('pluginKey') pluginKey?: string,
    @Query('triggerMode') triggerMode?: QqbotPluginTriggerMode,
  ) {
    const [commandHealth, eventHealth] = await Promise.all([
      this.includesTriggerMode('command', triggerMode)
        ? this.pluginRegistry.health(pluginKey)
        : Promise.resolve([]),
      this.includesTriggerMode('event', triggerMode)
        ? this.eventPluginRegistry.health(pluginKey)
        : Promise.resolve([]),
    ]);
    return vbenSuccess([...commandHealth, ...eventHealth]);
  }

  @Get('event/list')
  @ApiOperation({ summary: 'QQBot 事件触发插件列表' })
  @ApiQuery({ name: 'selfId', required: false, type: String })
  async eventList(@Query('selfId') selfId?: string) {
    return vbenSuccess(await this.eventPluginRegistry.listPlugins(selfId));
  }

  @Post('event/bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定 QQBot 事件触发插件' })
  @ApiQuery({ name: 'pluginKey', type: String })
  @ApiQuery({ name: 'selfId', type: String })
  async eventBind(
    @Query('pluginKey') pluginKey: string,
    @Query('selfId') selfId: string,
  ) {
    return vbenSuccess(await this.eventPluginRegistry.bind(pluginKey, selfId));
  }

  @Post('event/unbind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解绑 QQBot 事件触发插件' })
  @ApiQuery({ name: 'pluginKey', type: String })
  @ApiQuery({ name: 'selfId', type: String })
  async eventUnbind(
    @Query('pluginKey') pluginKey: string,
    @Query('selfId') selfId: string,
  ) {
    return vbenSuccess(
      await this.eventPluginRegistry.unbind(pluginKey, selfId),
    );
  }

  private includesTriggerMode(
    target: QqbotPluginTriggerMode,
    triggerMode?: QqbotPluginTriggerMode,
  ) {
    return !triggerMode || triggerMode === target;
  }
}
