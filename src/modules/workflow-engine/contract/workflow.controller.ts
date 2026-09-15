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
import { vbenSuccess } from '@/common';
import {
  AutomationAction,
  AutomationPermissionGuard,
  AutomationResource,
} from '@/common/automation/automation-permission.guard';
import { DefinitionController } from '@/common/automation/definition.controller';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { WorkflowDefinitionService } from '../application/workflow-definition.service';
import type { WorkflowDefinition } from './workflow.types';
import type { PublishedReference } from '@/common/automation/definition.types';
import { WorkflowExecutionService } from '../application/workflow-execution.service';

@ApiTags('自动化工作流')
@Controller('automation/workflows')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Workflow')
export class WorkflowController extends DefinitionController<WorkflowDefinition> {
  constructor(
    private readonly workflows: WorkflowDefinitionService,
    private readonly execution: WorkflowExecutionService,
  ) {
    super(workflows.definitions, (definition) =>
      workflows.checkForPublish(definition),
    );
  }

  /**
   * 将工作流图的格式、拓扑和依赖问题返回给 X6 编辑器定位，不派发执行。
   * @param body - 当前画布对应的领域定义与布局。
   * @returns 带节点和字段身份的完整校验结果。
   */
  @Post('validate')
  @HttpCode(200)
  @AutomationAction('Edit')
  async validate(@Body() body: { definition: unknown }) {
    return vbenSuccess(await this.workflows.validate(body.definition));
  }

  /**
   * 校验固定表单版本或流程输入后创建运行，禁止把画布草稿直接作为执行内容。
   * @param body - 发布版本、页面值与幂等请求键。
   * @returns 持久运行身份。
   */
  @Post('runs')
  @HttpCode(200)
  @AutomationAction('Run')
  async start(
    @Body()
    body: {
      workflowRef: PublishedReference;
      values: Record<string, unknown>;
      executionKey: string;
    },
  ) {
    return vbenSuccess(
      await this.execution.startFromPage(
        body?.workflowRef,
        body?.values,
        body?.executionKey,
      ),
    );
  }

  /**
   * 向有流程发起权限的用户提供固定表单结构，不要求拥有表单管理权限。
   * @param id - 工作流资源身份。
   * @param version - 发起页选择的发布版本。
   * @returns 该版本的流程和绑定表单结构。
   */
  @Get(':id/versions/:version/launch')
  @AutomationAction('Run')
  async launch(@Param('id') id: string, @Param('version') version: string) {
    return vbenSuccess(
      await this.execution.presentation({ id, version: Number(version) }),
    );
  }

  /**
   * 按已授权运行身份提供历史图和表单结构，实例展示不额外依赖其他资源的管理权限。
   * @param runId - 流程运行身份。
   * @returns 运行所引用的固定结构。
   */
  @Get('runs/:runId/schema')
  @AutomationAction('List')
  async runSchema(@Param('runId') runId: string) {
    const run = await this.execution.read(runId);
    return vbenSuccess(
      await this.execution.presentation({
        id: run.workflowId,
        version: run.workflowVersion,
      }),
    );
  }

  /**
   * 返回流程与独立节点的持久进度，供运行图刷新或页面重新进入。
   * @param runId - 流程运行身份。
   * @returns 包含原子任务关联的实例详情。
   */
  @Get('runs/:runId')
  @AutomationAction('List')
  async run(@Param('runId') runId: string) {
    return vbenSuccess(await this.execution.read(runId));
  }

  /**
   * 请求终止父流程并协调其子任务取消，仍执行中的副作用不会被提前标成已结束。
   * @param runId - 流程运行身份。
   * @returns 保存取消意图后的实例状态。
   */
  @Post('runs/:runId/cancel')
  @HttpCode(200)
  @AutomationAction('Cancel')
  async cancel(@Param('runId') runId: string) {
    return vbenSuccess(await this.execution.cancel(runId));
  }
}
