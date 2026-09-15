import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import type { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import {
  AutomationAction,
  AutomationPermissionGuard,
  AutomationResource,
} from '@/common/automation/automation-permission.guard';
import { DefinitionController } from '@/common/automation/definition.controller';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { TaskDefinitionService } from '../application/task-definition.service';
import { TaskExecutionService } from '../application/task-execution.service';
import type { AtomicTaskDefinition } from './task-definition.types';
import type { TaskExecutionRequest } from './task-execution.port';

@ApiTags('原子任务')
@Controller('automation/tasks')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Task')
export class TaskExecutionController extends DefinitionController<AtomicTaskDefinition> {
  constructor(
    private readonly tasks: TaskDefinitionService,
    private readonly execution: TaskExecutionService,
  ) {
    super(tasks.definitions, (definition) => tasks.checkForPublish(definition));
  }

  /**
   * 返回可选择的发布任务版本与可用性，不把流程定义混入原子任务目录。
   * @returns 已发布任务的能力列表。
   */
  @Get('capabilities')
  @AutomationAction('List')
  async capabilities() {
    return vbenSuccess(await this.tasks.capabilities());
  }

  /**
   * 解析已有流程固定引用的任务版本，退役处理器仍保留其发布数据契约。
   * @param id - 原子任务资源身份。
   * @param version - 已发布任务版本。
   * @returns 固定任务契约和当前可用性。
   */
  @Get(':id/versions/:version/capability')
  @AutomationAction('List')
  async capability(@Param('id') id: string, @Param('version') version: string) {
    return vbenSuccess(await this.tasks.resolve({ id, version: Number(version) }));
  }

  /**
   * 列出当前代码装配的处理器及其固定输入输出契约。
   * @returns 不含执行函数的能力元数据。
   */
  @Get('handlers')
  @AutomationAction('List')
  async handlers() {
    return vbenSuccess(await this.tasks.handlers.catalog());
  }

  /**
   * 从任务发起页提交固定版本与经过动态表单校验的参数，返回持久运行身份。
   * @param body - 任务版本、幂等请求键、输入和期限。
   * @returns 当前运行状态。
   */
  @Post('runs')
  @HttpCode(200)
  @AutomationAction('Run')
  async start(@Body() body: TaskExecutionRequest) {
    return vbenSuccess(await this.execution.start(body));
  }

  /**
   * 按任务运行身份查询执行状态与声明输出。
   * @param runId - 运行记录标识。
   * @returns 当前任务运行。
   */
  @Get('runs/:runId')
  @AutomationAction('List')
  async run(@Param('runId') runId: string) {
    return vbenSuccess(await this.execution.details(runId));
  }

  /**
   * 将当前管理员的副作用核对结论封存到原子任务运行，保留原始状态和全部尝试。
   * @param runId - 需要人工核对的运行身份。
   * @param body - 核对分类及业务证据说明。
   * @param user - JWT 已校验并从数据库载入的管理员。
   * @returns 已封存核对记录的运行详情。
   */
  @Post('runs/:runId/review')
  @HttpCode(200)
  @AutomationAction('Review')
  async review(@Param('runId') runId: string, @Body() body: unknown, @CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.execution.review(runId, user?.id, body));
  }

  /**
   * 向已持久化的任务运行发送取消意图，处理器退出前不释放执行锁。
   * @param runId - 待取消的运行标识。
   * @returns 取消请求提交后的状态。
   */
  @Post('runs/:runId/cancel')
  @HttpCode(200)
  @AutomationAction('Cancel')
  async cancel(@Param('runId') runId: string) {
    return vbenSuccess(await this.execution.cancel(runId));
  }
}
