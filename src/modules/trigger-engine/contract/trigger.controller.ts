import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import {
  AutomationAction,
  AutomationPermissionGuard,
  AutomationResource,
} from '@/common/automation/automation-permission.guard';
import { DefinitionController } from '@/common/automation/definition.controller';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { TriggerEngineService } from '../application/trigger-engine.service';
import type { TriggerDefinition } from './trigger.types';
import { TriggerEventRegistry } from '../application/trigger-event.registry';
import { TriggerOccurrenceService } from '../application/trigger-occurrence.service';

@ApiTags('自动化触发器')
@Controller('automation/triggers')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Trigger')
export class TriggerController extends DefinitionController<TriggerDefinition> {
  constructor(
    private readonly triggers: TriggerEngineService,
    private readonly events: TriggerEventRegistry,
    private readonly runtime: TriggerOccurrenceService,
  ) {
    super(triggers.definitions, (definition) =>
      triggers.checkForPublish(definition),
    );
  }

  /**
   * 为触发器编辑页展示未来发生时间，不登记调度目标或修改队列。
   * @param body - 当前触发器草稿。
   * @returns 规范配置与最多五次发生时间。
   */
  @Post('preview')
  @HttpCode(200)
  @AutomationAction('Test')
  preview(@Body() body: { definition: unknown }) {
    return vbenSuccess(this.triggers.preview(body?.definition));
  }

  /**
   * 给触发编辑器提供实际加载的事件源，避免操作者猜测事件标识和载荷。
   * @returns 可选择的固定版本及公开字段契约。
   */
  @Get('event-sources')
  @AutomationAction('List')
  eventSources() {
    return vbenSuccess(this.events.catalog());
  }

  /**
   * 展示当前触发器的注册生命周期，关联的计划内容由消费模块维护。
   * @param id - 当前触发器身份。
   * @returns 最近一百个注册状态。
   */
  @Get(':id/registrations')
  @AutomationAction('List')
  async registrations(@Param('id') id: string) {
    return vbenSuccess(await this.runtime.registrations(id));
  }

  /**
   * 展示持久发生记录和消费确认状态，支持按稳定身份继续翻页。
   * @param id - 当前触发器身份。
   * @param beforeId - 上一页返回的继续读取游标。
   * @returns 发生记录列表及下一页游标。
   */
  @Get(':id/occurrences')
  @AutomationAction('List')
  async occurrences(
    @Param('id') id: string,
    @Query('beforeId') beforeId?: string,
  ) {
    return vbenSuccess(await this.runtime.occurrences(id, beforeId));
  }
}
