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
import { ScheduleDefinitionService } from '../application/schedule-definition.service';
import { ScheduleControlService } from '../application/schedule-control.service';
import { ScheduleDispatchService } from '../application/schedule-dispatch.service';
import type { ScheduleDefinition } from './schedule.types';

@ApiTags('调度计划')
@Controller('automation/schedules')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Schedule')
export class ScheduleController extends DefinitionController<ScheduleDefinition> {
  constructor(
    schedules: ScheduleDefinitionService,
    private readonly control: ScheduleControlService,
    private readonly dispatch: ScheduleDispatchService,
  ) {
    super(schedules.definitions, async (definition) => {
      await schedules.checkForPublish(definition);
    });
  }

  /**
   * 一次返回计划草稿分页和对应运行摘要，使表格重绘不触发单元格状态请求。
   * @param query - 名称筛选和分页条件，沿用定义仓库的范围校验。
   * @returns 附带控制状态及最近派发的原始分页，启停权限和历史接口保持独立。
   */
  @Get('page')
  @AutomationAction('List')
  async page(@Query() query: Record<string, unknown>) {
    const page = await this.definitions.page(query);
    const ids = page.list.map((row) => row.id);
    const [states, latest] = await Promise.all([
      this.control.states(ids), this.dispatch.latest(ids),
    ]);
    return vbenSuccess({
      ...page,
      list: page.list.map((row) => ({
        ...row,
        runtime: { state: states.get(row.id)!, latest: latest.get(row.id) ?? null },
      })),
    });
  }

  /**
   * 展示计划启停修订、当前固定版本和触发注册实际阶段。
   * @param id - 当前计划资源身份。
   * @returns 与草稿修订独立的计划控制状态。
   */
  @Get(':id/state')
  @AutomationAction('List')
  async state(@Param('id') id: string) {
    return vbenSuccess(await this.control.state(id));
  }

  /**
   * 将显式发布版本设为计划执行版本，保存关联后再开放触发事件。
   * @param id - 待启用的计划身份。
   * @param body - 固定发布版本与页面读取的控制修订号。
   * @returns 保存后的计划控制状态和激活错误。
   */
  @Post(':id/enable')
  @HttpCode(200)
  @AutomationAction('Control')
  async enable(
    @Param('id') id: string,
    @Body() body: { version: number; expectedRevision: number },
  ) {
    return vbenSuccess(
      await this.control.enable(
        { id, version: body?.version },
        body?.expectedRevision,
      ),
    );
  }

  /**
   * 停止接纳新的计划运行，已经通过准入的派发继续恢复到可确认状态。
   * @param id - 待停用的计划身份。
   * @param body - 页面最后读取的控制修订号。
   * @returns 停用后的状态。
   */
  @Post(':id/disable')
  @HttpCode(200)
  @AutomationAction('Control')
  async disable(
    @Param('id') id: string,
    @Body() body: { expectedRevision: number },
  ) {
    return vbenSuccess(await this.control.disable(id, body?.expectedRevision));
  }

  /**
   * 从手动计划入口产生可追溯事件，后续仍执行同一准入规则和参数映射。
   * @param id - 已启用的手动计划身份。
   * @param body - 本次用户操作的稳定事件身份。
   * @returns 保存后的触发发生记录。
   */
  @Post(':id/fire')
  @HttpCode(200)
  @AutomationAction('Run')
  async fire(@Param('id') id: string, @Body() body: { eventId: string }) {
    return vbenSuccess(await this.control.fire(id, body?.eventId));
  }

  /**
   * 展示当前计划的准入、派发和执行结果，目标详情仍由原子任务或工作流模块提供。
   * @param id - 当前计划身份。
   * @param beforeId - 上一页返回的历史游标。
   * @returns 派发记录和继续读取游标。
   */
  @Get(':id/history')
  @AutomationAction('List')
  async history(@Param('id') id: string, @Query('beforeId') beforeId?: string) {
    return vbenSuccess(await this.dispatch.history(id, beforeId));
  }
}
