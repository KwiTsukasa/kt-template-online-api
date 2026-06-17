import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import {
  QqbotPlugin,
  QqbotPluginTask,
  QqbotPluginTaskRun,
} from '../../infrastructure/persistence';
import { requireQqbotPluginTaskCron } from './qqbot-plugin-task-cron.validator';
import type {
  QqbotPluginTaskPageQuery,
  QqbotPluginTaskRunPageQuery,
} from './qqbot-plugin-task.types';

@Injectable()
export class QqbotPluginTaskService {
  constructor(
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
    @InjectRepository(QqbotPluginTaskRun)
    private readonly runRepository: Repository<QqbotPluginTaskRun>,
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository: Repository<QqbotPlugin>,
    private readonly toolsService: ToolsService,
  ) {}

  async pageTasks(query: QqbotPluginTaskPageQuery) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(query);
    const where: FindOptionsWhere<QqbotPluginTask> = {};
    const pluginId = await this.resolvePluginIdFilter(query);
    if (pluginId) where.pluginId = pluginId;
    if (query.taskKey) where.taskKey = query.taskKey;
    if (query.status) where.runtimeStatus = query.status;
    if (query.enabled !== undefined) {
      where.enabled = this.toolsService.normalizeBoolean(query.enabled);
    }
    const [list, total] = await this.taskRepository.findAndCount({
      order: { createTime: 'DESC' },
      skip,
      take: pageSize,
      where,
    });
    return { list, pageNo, pageSize, total };
  }

  async getTaskDetail(id: string) {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throwVbenError('插件定时任务不存在');
    return task;
  }

  async enableTask(id: string) {
    await this.taskRepository.update(
      { id },
      { enabled: true, runtimeStatus: 'scheduled' },
    );
    return this.getTaskDetail(id);
  }

  async disableTask(id: string) {
    await this.taskRepository.update(
      { id },
      { enabled: false, runtimeStatus: 'disabled' },
    );
    return this.getTaskDetail(id);
  }

  async updateTaskCron(id: string, body: { cronExpression?: string }) {
    const cronExpression = requireQqbotPluginTaskCron(body.cronExpression);
    await this.taskRepository.update({ id }, { cronExpression });
    return this.getTaskDetail(id);
  }

  async runTaskOnce(id: string, body: { input?: Record<string, unknown> }) {
    void body;
    const task = await this.getTaskDetail(id);
    const run = await this.runRepository.save({
      installationId: task.installationId,
      pluginId: task.pluginId,
      status: 'running',
      taskId: task.id,
      taskKey: task.taskKey,
      triggerType: 'manual',
    });
    return { jobId: run.jobId || `${run.id || ''}`, taskId: task.id };
  }

  async pageTaskRuns(id: string, query: QqbotPluginTaskRunPageQuery) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(query);
    const where: FindOptionsWhere<QqbotPluginTaskRun> = { taskId: id };
    if (query.status) where.status = query.status;
    if (query.triggerType) where.triggerType = query.triggerType;
    Object.assign(where, this.buildRunTimeFilter(query));
    const [list, total] = await this.runRepository.findAndCount({
      order: { createTime: 'DESC' },
      skip,
      take: pageSize,
      where,
    });
    return { list, pageNo, pageSize, total };
  }

  private async resolvePluginIdFilter(query: QqbotPluginTaskPageQuery) {
    if (query.pluginId) return query.pluginId;
    if (!query.pluginKey) return undefined;

    const plugin = await this.pluginRepository.findOne({
      where: { pluginKey: query.pluginKey },
    });
    return plugin?.id || '__missing_plugin__';
  }

  private buildRunTimeFilter(query: QqbotPluginTaskRunPageQuery) {
    if (query.startTime && query.endTime) {
      return {
        createTime: Between(query.startTime, query.endTime),
      };
    }
    if (query.startTime) {
      return {
        createTime: MoreThanOrEqual(query.startTime),
      };
    }
    if (query.endTime) {
      return {
        createTime: LessThanOrEqual(query.endTime),
      };
    }
    return {};
  }
}
