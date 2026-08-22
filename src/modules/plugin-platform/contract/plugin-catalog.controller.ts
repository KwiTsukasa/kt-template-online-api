import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { PluginPlatformService } from '../application/plugin-platform.service';
import { PluginEventRegistryService } from '../application/registry/plugin-event-registry.service';
import type {
  BotPluginSummary as PluginSummary,
  BotPluginTriggerMode as PluginTriggerMode,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import {
  PluginPlatformPermission,
  PluginPlatformPermissionGuard,
} from './plugin-platform-permission.guard';

type PluginOperationPageQuery = {
  pageNo?: number | string;
  pageSize?: number | string;
  pluginKey?: string;
  triggerMode?: PluginTriggerMode;
};

@ApiTags('Bot - 插件能力')
@Controller('plugin-platform/catalog')
@UseGuards(JwtAuthGuard, PluginPlatformPermissionGuard)
@PluginPlatformPermission('PluginPlatform:Plugin:List')
export class PluginController {
  constructor(
    private readonly eventPluginRegistry: PluginEventRegistryService,
    private readonly service: PluginPlatformService,
  ) {}

  /**
   * 按`triggerMode`读取`list` 对应结果；从 `service.listPluginSummaries` 读取`list` 对应结果。
   * @param triggerMode - 决定`list` 对应结果内容、边界或目标的 `triggerMode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'Bot 插件列表' })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async list(@Query('triggerMode') triggerMode?: PluginTriggerMode) {
    const pluginSummaries: PluginSummary[] = [];
    if (this.includesTriggerMode('command', triggerMode)) {
      pluginSummaries.push(...(await this.service.listPluginSummaries()));
    }
    if (this.includesTriggerMode('event', triggerMode)) {
      pluginSummaries.push(
        ...this.eventPluginRegistry.listDefinitions().map((definition) => ({
          description: definition.description,
          key: definition.key,
          name: definition.name,
          operationCount: 1,
          triggerMode: 'event' as const,
          version: definition.version,
        })),
      );
    }
    return vbenSuccess(pluginSummaries);
  }

  /**
   * 根据`pluginKey`、`triggerMode`处理操作；从 `service.listOperationSummaries` 读取操作。
   * @param pluginKey - 用于读取或更新操作的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param triggerMode - 决定操作内容、边界或目标的 `triggerMode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 操作。
   */
  @Get('operation/list')
  @ApiOperation({ summary: 'Bot 插件能力列表' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async operationList(
    @Query('pluginKey') pluginKey?: string,
    @Query('triggerMode') triggerMode?: PluginTriggerMode,
  ) {
    return vbenSuccess(
      await this.service.listOperationSummaries({ pluginKey, triggerMode }),
    );
  }

  /**
   * 按插件键、触发模式与分页条件读取插件能力摘要，并封装为 Vben 成功响应。
   * @param query - 限定操作分页结果筛选、排序与分页范围的查询条件。
   * @returns 操作分页。
   */
  @Get('operation/page')
  @ApiOperation({ summary: 'Bot 插件能力分页列表' })
  @ApiQuery({ name: 'pageNo', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async operationPage(@Query() query: PluginOperationPageQuery) {
    return vbenSuccess(await this.service.pageOperationSummaries(query));
  }

  /**
   * 根据`pluginKey`、`triggerMode`处理Bot 插件健康检查。
   * @param pluginKey - 用于读取或更新Bot 插件健康检查的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param triggerMode - 决定Bot 插件健康检查内容、边界或目标的 `triggerMode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns Bot 插件健康检查。
   */
  @Get('health')
  @ApiOperation({ summary: 'Bot 插件健康检查' })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async health(
    @Query('pluginKey') pluginKey?: string,
    @Query('triggerMode') triggerMode?: PluginTriggerMode,
  ) {
    const [commandHealth, eventHealth] = await Promise.all([
      (() => {
        if (this.includesTriggerMode('command', triggerMode)) {
          return this.service.listPluginHealth(pluginKey);
        }
        return Promise.resolve([]);
      })(),
      (() => {
        if (this.includesTriggerMode('event', triggerMode)) {
          return this.eventPluginRegistry.health(pluginKey);
        }
        return Promise.resolve([]);
      })(),
    ]);
    return vbenSuccess([...commandHealth, ...eventHealth]);
  }

  /**
   * 读取平台无关事件插件定义，账号绑定由各 Bot 连接模块单独提供。
   * @returns 当前启用的事件插件定义。
   */
  @Get('event/list')
  @ApiOperation({ summary: 'Bot 协议事件插件列表' })
  eventList() {
    return vbenSuccess(this.eventPluginRegistry.listPlugins());
  }

  /**
   * 根据`target`、`triggerMode`处理触发模式Mode。
   * @param target - 决定触发模式Mode内容、边界或目标的 `target` 值。
   * @param triggerMode - 决定触发模式Mode内容、边界或目标的 `triggerMode` 值；为空时采用 `triggerMode === target` 作为兜底。
   * @returns 规范化后的触发模式Mode；主值为空时采用 `triggerMode === target` 兜底。
   */
  private includesTriggerMode(
    target: PluginTriggerMode,
    triggerMode?: PluginTriggerMode,
  ) {
    return !triggerMode || triggerMode === target;
  }
}
