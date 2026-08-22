import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { PluginTaskService } from '../application/task';
import {
  PluginPlatformPermission,
  PluginPlatformPermissionGuard,
} from './plugin-platform-permission.guard';

@ApiTags('Bot - 插件定时任务')
@Controller('plugin-platform/tasks')
@UseGuards(JwtAuthGuard, PluginPlatformPermissionGuard)
@PluginPlatformPermission('PluginPlatform:Task:List')
export class PluginPlatformTaskController {
  constructor(private readonly service: PluginTaskService) {}

  /**
   * 按`query`读取针对插件定时任务分页。
   * @param query - 限定针对插件定时任务分页筛选、排序与分页范围的查询条件。
   * @returns 针对插件定时任务分页。
   */
  @Get('page')
  @ApiOperation({ summary: '插件定时任务分页' })
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTasks(query));
  }

  /**
   * 按`id`读取针对插件定时任务详情；从 `service.getTaskDetail` 读取针对插件定时任务详情。
   * @param id - 决定针对插件定时任务详情内容、边界或目标的 `id` 值。
   * @returns 针对插件定时任务详情。
   */
  @Get(':id')
  @ApiOperation({ summary: '插件定时任务详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.service.getTaskDetail(id));
  }

  /**
   * 按`id`启动针对插件定时任务。
   * @param id - 决定针对插件定时任务内容、边界或目标的 `id` 值。
   * @returns 针对插件定时任务。
   */
  @Post(':id/enable')
  @PluginPlatformPermission('PluginPlatform:Task:Enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件定时任务' })
  async enable(@Param('id') id: string) {
    return vbenSuccess(await this.service.enableTask(id));
  }

  /**
   * 根据参数 `id`，停用插件定时任务。
   * @param id - 决定根据参数 `id`，停用插件定时任务内容、边界或目标的 `id` 值。
   * @returns 根据参数 `id`，停用插件定时任务。
   */
  @Post(':id/disable')
  @PluginPlatformPermission('PluginPlatform:Task:Disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用插件定时任务' })
  async disable(@Param('id') id: string) {
    return vbenSuccess(await this.service.disableTask(id));
  }

  /**
   * 根据`id`、`body`更新插件定时任务 cron。
   * @param id - 决定插件定时任务 cron内容、边界或目标的 `id` 值。
   * @param body - 用于插件定时任务 cron的结构化输入。
   * @returns 插件定时任务 cron。
   */
  @Post(':id/cron')
  @PluginPlatformPermission('PluginPlatform:Task:UpdateCron')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件定时任务 cron' })
  async updateCron(
    @Param('id') id: string,
    @Body() body: { cronExpression?: string },
  ) {
    return vbenSuccess(await this.service.updateTaskCron(id, body));
  }

  /**
   * 根据`id`、`body`处理针对插件定时任务。
   * @param id - 决定针对插件定时任务内容、边界或目标的 `id` 值。
   * @param body - 用于针对插件定时任务的结构化输入。
   * @returns 针对插件定时任务。
   */
  @Post(':id/run')
  @PluginPlatformPermission('PluginPlatform:Task:Run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动运行插件定时任务' })
  async run(
    @Param('id') id: string,
    @Body() body: { input?: Record<string, unknown> },
  ) {
    return vbenSuccess(await this.service.runTaskOnce(id, body));
  }

  /**
   * 根据当前平台状态返回插件定时任务运行记录分页。
   * @param id - 决定根据当前平台状态返回插件定时任务运行记录分页内容、边界或目标的 `id` 值。
   * @param query - 限定根据当前平台状态返回插件定时任务运行记录分页筛选、排序与分页范围的查询条件。
   * @returns 根据当前平台状态返回插件定时任务运行记录分页。
   */
  @Get(':id/runs')
  @PluginPlatformPermission('PluginPlatform:Task:RunLog')
  @ApiOperation({ summary: '插件定时任务运行记录分页' })
  async runs(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTaskRuns(id, query));
  }
}
