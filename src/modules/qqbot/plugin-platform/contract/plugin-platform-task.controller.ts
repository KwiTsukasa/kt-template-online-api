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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotPluginTaskService } from '../application/task';

@ApiTags('QQBot - 插件定时任务')
@Controller('qqbot/plugin-platform/tasks')
@UseGuards(JwtAuthGuard)
export class QqbotPluginPlatformTaskController {
  /**
   * 初始化 QqbotPluginPlatformTaskController 实例。
   * @param service - service 输入；影响 constructor 的返回值。
   */
  constructor(private readonly service: QqbotPluginTaskService) {}

  /**
   * 插件定时任务分页。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
  @Get('page')
  @ApiOperation({ summary: '插件定时任务分页' })
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTasks(query));
  }

  /**
   * 插件定时任务详情。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  @Get(':id')
  @ApiOperation({ summary: '插件定时任务详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.service.getTaskDetail(id));
  }

  /**
   * 启用插件定时任务。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件定时任务' })
  async enable(@Param('id') id: string) {
    return vbenSuccess(await this.service.enableTask(id));
  }

  /**
   * 停用插件定时任务。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用插件定时任务' })
  async disable(@Param('id') id: string) {
    return vbenSuccess(await this.service.disableTask(id));
  }

  /**
   * 更新插件定时任务 cron。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post(':id/cron')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件定时任务 cron' })
  async updateCron(
    @Param('id') id: string,
    @Body() body: { cronExpression?: string },
  ) {
    return vbenSuccess(await this.service.updateTaskCron(id, body));
  }

  /**
   * 手动运行插件定时任务。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动运行插件定时任务' })
  async run(
    @Param('id') id: string,
    @Body() body: { input?: Record<string, unknown> },
  ) {
    return vbenSuccess(await this.service.runTaskOnce(id, body));
  }

  /**
   * 插件定时任务运行记录分页。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
  @Get(':id/runs')
  @ApiOperation({ summary: '插件定时任务运行记录分页' })
  async runs(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTaskRuns(id, query));
  }
}
