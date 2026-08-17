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
   * 按`query`读取分页结果Tasks；从 `toolsService.getPageParams` 读取分页结果Tasks。
   * @param query - 限定分页结果Tasks筛选、排序与分页范围的查询条件，包含 `taskKey`、`status`、`enabled` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的分页结果Tasks。
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
   * 按`id`读取任务详情；从 `taskRepository.findOne` 读取任务详情。
   * @param id - 决定任务详情内容、边界或目标的 `id` 值。
   * @returns 任务详情。
   */
  async getTaskDetail(id: string) {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throwVbenError('插件定时任务不存在');
    return task;
  }

  /**
   * 按`id`启动任务；把变更持久化到当前存储（`taskRepository.save`）。
   * @param id - 决定任务内容、边界或目标的 `id` 值。
   * @returns 任务。
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
   * 按`id`停止任务并清理该入口拥有的运行态资源；把变更持久化到当前存储（`taskRepository.save`）。
   * @param id - 决定任务内容、边界或目标的 `id` 值。
   * @returns 任务。
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
   * 根据`id`、`body`更新任务Cron；把变更持久化到当前存储（`taskRepository.save`）。
   * @param id - 决定任务Cron内容、边界或目标的 `id` 值。
   * @param body - 用于任务Cron的结构化输入，包含 `cronExpression` 字段。
   * @returns 任务Cron。
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
   * 根据`id`、`body`处理任务Once；先通过 `requireScheduler` 校验输入边界。
   * @param id - 决定任务Once内容、边界或目标的 `id` 值。
   * @param body - 用于任务Once的结构化输入，包含 `input` 字段。
   * @returns 包含 `jobId`、`taskId` 字段的任务Once。
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
   * 按`id`、`query`读取分页结果任务Runs；从 `toolsService.getPageParams` 读取分页结果任务Runs。
   * @param id - 决定分页结果任务Runs内容、边界或目标的 `id` 值。
   * @param query - 限定分页结果任务Runs筛选、排序与分页范围的查询条件，包含 `status`、`triggerType` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的分页结果任务Runs。
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
   * 从`query`解析插件标识；从 `pluginRepository.findOne` 读取插件标识。
   * @param query - 限定插件标识筛选、排序与分页范围的查询条件，包含 `pluginId`、`pluginKey` 字段。
   * @returns 规范化后的插件标识；主值为空时采用 `'__missing_plugin__'` 兜底；没有可用结果或提前结束时为 `undefined`。
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
   * 根据`query`构造时间；当 `query.startTime && query.endTime` 成立时返回 `{ createTime: Between(query.startTime, quer…`。
   * @param query - 限定时间筛选、排序与分页范围的查询条件，包含 `startTime`、`endTime` 字段。
   * @returns 时间。
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
   * 返回已注入的插件定时任务调度器；调度器未初始化时以业务错误拒绝调用。
   * @returns 已注入的插件定时任务调度器。
   */
  private requireScheduler() {
    if (!this.scheduler) {
      throwVbenError('插件定时任务调度器未初始化');
    }
    return this.scheduler;
  }
}
