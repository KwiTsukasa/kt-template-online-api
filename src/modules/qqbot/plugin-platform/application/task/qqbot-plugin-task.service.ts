import { Injectable, Optional } from '@nestjs/common';
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
import { QqbotPluginTaskSchedulerService } from './qqbot-plugin-task-scheduler.service';

@Injectable()
export class QqbotPluginTaskService {
  /**
   * 初始化 QqbotPluginTaskService 实例。
   * @param taskRepository - 插件任务仓库依赖；影响 constructor 的返回值。
   * @param runRepository - 插件平台仓库依赖；影响 constructor 的返回值。
   * @param pluginRepository - 插件仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param scheduler - scheduler 输入；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
    @InjectRepository(QqbotPluginTaskRun)
    private readonly runRepository: Repository<QqbotPluginTaskRun>,
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository: Repository<QqbotPlugin>,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly scheduler?: QqbotPluginTaskSchedulerService,
  ) {}

  /**
   * 执行 QQBot 插件平台流程。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
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

  /**
   * 查询 QQBot 插件平台数据。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  async getTaskDetail(id: string) {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throwVbenError('插件定时任务不存在');
    return task;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  async enableTask(id: string) {
    const task = await this.getTaskDetail(id);
    task.enabled = true;
    task.runtimeStatus = 'scheduled';
    const saved = await this.taskRepository.save(task);
    const schedulerState =
      await this.requireScheduler().syncTaskScheduler(saved);
    if (schedulerState) Object.assign(saved, schedulerState);
    return saved;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   */
  async disableTask(id: string) {
    const task = await this.getTaskDetail(id);
    task.enabled = false;
    task.nextRunAt = null;
    task.runtimeStatus = 'disabled';
    const saved = await this.taskRepository.save(task);
    await this.requireScheduler().removeTaskScheduler(id);
    return saved;
  }

  /**
   * 更新Task Cron。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  async updateTaskCron(id: string, body: { cronExpression?: string }) {
    const task = await this.getTaskDetail(id);
    task.cronExpression = requireQqbotPluginTaskCron(body.cronExpression);
    const saved = await this.taskRepository.save(task);
    const schedulerState =
      await this.requireScheduler().syncTaskScheduler(saved);
    if (schedulerState) Object.assign(saved, schedulerState);
    return saved;
  }

  /**
   * 执行Task Once。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  async runTaskOnce(id: string, body: { input?: Record<string, unknown> }) {
    await this.getTaskDetail(id);
    const job = await this.requireScheduler().enqueueManualRun(
      id,
      body.input || {},
    );
    return { jobId: `${job.id || ''}`, taskId: id };
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param id - 插件平台记录 ID；定位本次读取、更新、删除或关联的插件平台记录。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
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

  /**
   * 解析Plugin Id Filter。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
  private async resolvePluginIdFilter(query: QqbotPluginTaskPageQuery) {
    if (query.pluginId) return query.pluginId;
    if (!query.pluginKey) return undefined;

    const plugin = await this.pluginRepository.findOne({
      where: { pluginKey: query.pluginKey },
    });
    return plugin?.id || '__missing_plugin__';
  }

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   */
  private requireScheduler() {
    if (!this.scheduler) {
      throwVbenError('插件定时任务调度器未初始化');
    }
    return this.scheduler;
  }
}
