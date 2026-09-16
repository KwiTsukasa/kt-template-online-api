import { CurrentAdminUser } from '@/common';
import type { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MediaWorkflowService } from '../application/media-workflow.service';
import {
  MediaWorkflowCancelDto,
  MediaWorkflowHumanSubmitDto,
} from '../contract/media-workflow.dto';
import {
  MediaGovernancePermission,
  MediaGovernancePermissionGuard,
} from './media-governance-permission.guard';

@ApiTags('Admin - 媒体业务工作流')
@Controller('media-governance/tasks/:taskId/workflow')
@UseGuards(JwtAuthGuard, MediaGovernancePermissionGuard)
@MediaGovernancePermission('Media:Governance:List')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class MediaWorkflowController {
  constructor(private readonly workflows: MediaWorkflowService) {}

  /**
   * 按媒体对象读取最近流程，页面无需知道或猜测其他运行标识。
   * @param taskId - 已授权查看的媒体 Task。
   * @returns 最近运行及节点状态，没有运行时为空。
   */
  @Get('runs/latest')
  @Header('Cache-Control', 'no-store')
  async latest(@Param('taskId') taskId: string) {
    return vbenSuccess(await this.workflows.latest(taskId));
  }

  /**
   * 在当前业务对象内展示工作流已经到达的人工节点。
   * @param taskId - 已授权的媒体任务。
   * @returns 固定版本的表单和活动实例身份。
   */
  @Get('human-tasks')
  @Header('Cache-Control', 'no-store')
  async humanTasks(@Param('taskId') taskId: string) {
    return vbenSuccess(await this.workflows.humanTasks(taskId));
  }

  /**
   * 将节点填写值或确认提交给当前实例，身份和权限不接受表单改写。
   * @param taskId - 当前媒体任务。
   * @param body - 当前活动身份与允许填写的数据。
   * @param user - 认证守卫确定的办理人。
   * @returns 保存后的原流程实例状态。
   */
  @Post('human-tasks/complete')
  @HttpCode(200)
  @MediaGovernancePermission('Media:Governance:WorkflowRun')
  async completeHumanTask(@Param('taskId') taskId: string, @Body() body: MediaWorkflowHumanSubmitDto, @CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.workflows.completeHumanTask(taskId, body.runId, body.executionId, String(user.id), body.values));
  }

  /**
   * 向同一媒体任务的工作流提交取消意图，终态由工作流核对脚本回执后决定。
   * @param taskId - 已授权操作的媒体 Task。
   * @param body - 页面当前显示的工作流运行身份。
   * @returns 取消请求后的最新流程状态。
   */
  @Post('cancel')
  @HttpCode(200)
  @MediaGovernancePermission('Media:Governance:WorkflowRun')
  async cancel(
    @Param('taskId') taskId: string,
    @Body() body: MediaWorkflowCancelDto,
  ) {
    return vbenSuccess(await this.workflows.cancel(taskId, body.runId));
  }
}
