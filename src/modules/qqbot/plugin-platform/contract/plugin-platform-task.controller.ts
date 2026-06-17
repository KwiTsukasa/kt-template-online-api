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
  constructor(private readonly service: QqbotPluginTaskService) {}

  @Get('page')
  @ApiOperation({ summary: '插件定时任务分页' })
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTasks(query));
  }

  @Get(':id')
  @ApiOperation({ summary: '插件定时任务详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.service.getTaskDetail(id));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用插件定时任务' })
  async enable(@Param('id') id: string) {
    return vbenSuccess(await this.service.enableTask(id));
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用插件定时任务' })
  async disable(@Param('id') id: string) {
    return vbenSuccess(await this.service.disableTask(id));
  }

  @Post(':id/cron')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新插件定时任务 cron' })
  async updateCron(
    @Param('id') id: string,
    @Body() body: { cronExpression?: string },
  ) {
    return vbenSuccess(await this.service.updateTaskCron(id, body));
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动运行插件定时任务' })
  async run(
    @Param('id') id: string,
    @Body() body: { input?: Record<string, unknown> },
  ) {
    return vbenSuccess(await this.service.runTaskOnce(id, body));
  }

  @Get(':id/runs')
  @ApiOperation({ summary: '插件定时任务运行记录分页' })
  async runs(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.service.pageTaskRuns(id, query));
  }
}
