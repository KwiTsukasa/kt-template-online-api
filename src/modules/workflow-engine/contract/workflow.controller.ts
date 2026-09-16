import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
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
import type { WorkflowDocument } from './workflow.types';
import { WorkflowExecutionService } from '../application/workflow-execution.service';
import { WorkflowProcessRegistry } from '../application/workflow-process.registry';
import { WorkflowScriptRegistry } from '../application/workflow-script.registry';
import { WorkflowScriptAssetsService } from '../application/workflow-script-assets.service';
import { exportWorkflowBpmnXml } from '../domain/workflow-bpmn.policy';
import type { WorkflowBpmnDefinition } from './workflow-bpmn.types';

@ApiTags('自动化工作流')
@Controller('automation/workflows')
@UseGuards(JwtAuthGuard, AutomationPermissionGuard)
@AutomationResource('Workflow')
export class WorkflowController extends DefinitionController<WorkflowDocument> {
  constructor(
    private readonly workflows: WorkflowDefinitionService,
    private readonly execution: WorkflowExecutionService,
    private readonly processes: WorkflowProcessRegistry,
    private readonly scripts: WorkflowScriptRegistry,
    private readonly scriptAssets: WorkflowScriptAssetsService,
  ) {
    super(workflows.definitions, (definition) =>
      workflows.checkForPublish(definition),
    );
  }

  /**
   * 向编排器提供已装配业务接口及单步能力，业务实现不暴露可直接发起的执行路由。
   * @returns 固定版本的业务流程能力目录。
   */
  @Get('processes')
  @AutomationAction('List')
  processCatalog() {
    return vbenSuccess(this.processes.catalog());
  }

  /**
   * 返回固定版本脚本及其扩展参数声明，供编排器选择和自动生成配置表单。
   * @returns 不含源码和主机路径的脚本目录。
   */
  @Get('scripts')
  @AutomationAction('List')
  scriptCatalog() {
    return vbenSuccess(this.scripts.catalog());
  }

  /**
   * 静态解析上传脚本的标准声明，识别业务参数而不运行用户代码。
   * @param body - 文件名及 UTF-8 源码。
   * @returns 参数、默认值和结果字段的标准声明。
   */
  @Post('scripts/inspect')
  @HttpCode(200)
  @AutomationAction('Edit')
  inspectScript(@Body() body: { filename: unknown; source: unknown }) {
    return vbenSuccess(this.scriptAssets.inspect(body.filename, body.source));
  }

  /**
   * 在工作流权限内保存脚本新版本，后续运行继续固定到所选版本和内容摘要。
   * @param body - 已声明标准协议的源码和受控执行目标。
   * @returns 持久脚本版本及识别到的业务扩展参数。
   */
  @Post('scripts')
  @HttpCode(200)
  @AutomationAction('Edit')
  async uploadScript(
    @Body() body: { filename: unknown; source: unknown; target: unknown },
  ) {
    return vbenSuccess(await this.scriptAssets.upload(body));
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
   * 仅在用户显式导出时生成 BPMN XML，普通草稿与版本接口仍读写结构化模型。
   * @param body - 当前待导出的标准流程模型。
   * @returns 带下载文件名和 XML 内容类型的标准 .bpmn 文件。
   * @throws 模型或引用不合法时返回请求格式错误。
   */
  @Post('export')
  @HttpCode(200)
  @AutomationAction('List')
  async exportBpmn(@Body() body: { definition: WorkflowBpmnDefinition }) {
    try {
      const xml = await exportWorkflowBpmnXml(body?.definition);
      return new StreamableFile(Buffer.from(xml, 'utf8'), { type: 'application/xml; charset=utf-8', disposition: 'attachment; filename="workflow.bpmn"' });
    } catch (error) {
      throw new BadRequestException(error instanceof Error && error.message || '流程模型无法导出');
    }
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
   * 返回指定节点逐轮结果和脚本尝试，历史不会覆盖为下一轮当前值。
   * @param runId - 已授权工作流实例身份。
   * @param nodeId - 固定图内的节点身份。
   * @param beforeVisit - 读取更早记录时使用的轮次边界。
   * @returns 倒序轮次结果和下一页边界。
   */
  @Get('runs/:runId/nodes/:nodeId/visits')
  @AutomationAction('List')
  async nodeVisits(
    @Param('runId') runId: string,
    @Param('nodeId') nodeId: string,
    @Query('beforeVisit') beforeVisit?: string,
  ) {
    return vbenSuccess(
      await this.execution.nodeVisits(runId, nodeId, beforeVisit),
    );
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
