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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotPluginPlatformService } from '../application/plugin-platform.service';
import { QqbotEventPluginRegistryService } from '../application/registry/qqbot-event-plugin-registry.service';
import type {
  QqbotPluginSummary,
  QqbotPluginTriggerMode,
} from '@/modules/qqbot/core/contract/qqbot.types';

type QqbotPluginOperationPageQuery = {
  pageNo?: number | string;
  pageSize?: number | string;
  pluginKey?: string;
  triggerMode?: QqbotPluginTriggerMode;
};

@ApiTags('QQBot - 插件能力')
@Controller('qqbot/plugin')
@UseGuards(JwtAuthGuard)
export class QqbotPluginController {
  constructor(
    private readonly eventPluginRegistry: QqbotEventPluginRegistryService,
    private readonly service: QqbotPluginPlatformService,
  ) {}

  /**
   * 按`triggerMode`读取`list` 对应结果；从 `service.listPluginSummaries` 读取`list` 对应结果。
   * @param triggerMode - 决定`list` 对应结果内容、边界或目标的 `triggerMode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: 'QQBot 插件列表' })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async list(@Query('triggerMode') triggerMode?: QqbotPluginTriggerMode) {
    const pluginSummaries: QqbotPluginSummary[] = [];
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
  @ApiOperation({ summary: 'QQBot 插件能力分页列表' })
  @ApiQuery({ name: 'pageNo', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'pluginKey', required: false, type: String })
  @ApiQuery({
    enum: ['command', 'event'],
    name: 'triggerMode',
    required: false,
  })
  async operationPage(@Query() query: QqbotPluginOperationPageQuery) {
    return vbenSuccess(await this.service.pageOperationSummaries(query));
  }

  /**
   * 根据`pluginKey`、`triggerMode`处理QQBot 插件健康检查。
   * @param pluginKey - 用于读取或更新QQBot 插件健康检查的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param triggerMode - 决定QQBot 插件健康检查内容、边界或目标的 `triggerMode` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns QQBot 插件健康检查。
   */
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
   * 根据`selfId`处理事件；从 `eventPluginRegistry.listPlugins` 读取事件。
   * @param selfId - 用于精确定位QQ 账号的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 事件。
   */
  @Get('event/list')
  @ApiOperation({ summary: 'QQBot 事件触发插件列表' })
  @ApiQuery({ name: 'selfId', required: false, type: String })
  async eventList(@Query('selfId') selfId?: string) {
    return vbenSuccess(await this.eventPluginRegistry.listPlugins(selfId));
  }

  /**
   * 根据参数 `pluginKey`，绑定 QQBot 事件触发插件。
   * @param pluginKey - 用于读取或更新根据参数 `pluginKey`，绑定 QQBot 事件触发插件的稳定键。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 根据参数 `pluginKey`，绑定 QQBot 事件触发插件。
   */
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

  /**
   * 按插件键和 QQ 号解除事件插件绑定，并将注册表结果封装为 Vben 成功响应。
   * @param pluginKey - 用于读取或更新事件的稳定键。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 事件。
   */
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

  /**
   * 根据`target`、`triggerMode`处理触发模式Mode。
   * @param target - 决定触发模式Mode内容、边界或目标的 `target` 值。
   * @param triggerMode - 决定触发模式Mode内容、边界或目标的 `triggerMode` 值；为空时采用 `triggerMode === target` 作为兜底。
   * @returns 规范化后的触发模式Mode；主值为空时采用 `triggerMode === target` 兜底。
   */
  private includesTriggerMode(
    target: QqbotPluginTriggerMode,
    triggerMode?: QqbotPluginTriggerMode,
  ) {
    return !triggerMode || triggerMode === target;
  }
}
