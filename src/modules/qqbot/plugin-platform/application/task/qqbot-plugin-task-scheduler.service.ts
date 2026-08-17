import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue, type ConnectionOptions } from 'bullmq';
import { parseExpression } from 'cron-parser';
import { Repository } from 'typeorm';
import { QqbotPluginTask } from '../../infrastructure/persistence';

export type QqbotPluginTaskJobData = {
  input?: Record<string, unknown>;
  taskId: string;
  triggerType: 'manual' | 'schedule';
};

@Injectable()
export class QqbotPluginTaskSchedulerService
  implements OnModuleDestroy, OnModuleInit
{
  private readonly queue: Queue<QqbotPluginTaskJobData>;

  constructor(
    configService: ConfigService,
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
  ) {
    this.queue = new Queue(QQBOT_PLUGIN_TASK_QUEUE_NAME, {
      connection: resolveQqbotPluginTaskQueueConnection(configService),
      prefix: readQqbotPluginTaskQueuePrefix(configService),
    });
  }

  async onModuleInit() {
    await this.queue.waitUntilReady();
    await this.removeUnschedulableTaskSchedulers();
    await this.resyncEnabledTasks();
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  /**
   * 根据当前运行态处理resync启用状态Tasks；从 `findSchedulableTasks` 读取resync启用状态Tasks。
   */
  async resyncEnabledTasks() {
    const tasks = await this.findSchedulableTasks();
    for (const task of tasks) {
      await this.syncTaskScheduler(task);
    }
  }

  /**
   * 按当前运行态移除不可调度任务Schedulers；把变更持久化到当前存储（`taskRepository.update`）。
   */
  async removeUnschedulableTaskSchedulers() {
    const tasks = await this.findUnschedulableEnabledTasks();
    for (const task of tasks) {
      await this.removeTaskScheduler(task.id);
      await this.taskRepository.update(
        { id: task.id },
        { nextRunAt: null, runtimeStatus: 'disabled' },
      );
    }
  }

  /**
   * 通过 `buildSchedulerId` 生成稳定标识。
   * @param task - 用于任务调度器的领域对象，包含 `id`、`enabled`、`cronExpression` 字段。
   * @returns 包含 `nextRunAt`、`runtimeStatus` 字段的任务调度器。
   */
  async syncTaskScheduler(
    task: Pick<
      QqbotPluginTask,
      | 'cronExpression'
      | 'enabled'
      | 'id'
      | 'installationId'
      | 'taskKey'
      | 'timeoutMs'
    >,
  ) {
    const schedulerId = this.buildSchedulerId(task.id);
    if (!task.enabled || !(await this.isTaskSchedulable(task.id))) {
      await this.removeTaskScheduler(task.id);
      const state = { nextRunAt: null, runtimeStatus: 'disabled' as const };
      await this.taskRepository.update({ id: task.id }, state);
      return state;
    }

    const nextRunAt = resolveNextQqbotPluginTaskRunAt(task.cronExpression);
    await this.queue.upsertJobScheduler(
      schedulerId,
      { pattern: task.cronExpression },
      {
        data: {
          taskId: task.id,
          triggerType: 'schedule',
        },
        name: QQBOT_PLUGIN_TASK_JOB_NAME,
        opts: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    await this.taskRepository.update(
      { id: task.id },
      {
        nextRunAt: nextRunAt as any,
        runtimeStatus: 'scheduled',
      },
    );
    return { nextRunAt, runtimeStatus: 'scheduled' as const };
  }

  /**
   * 按`taskId`移除任务调度器。
   * @param taskId - 用于精确定位任务的标识。
   */
  async removeTaskScheduler(taskId: string) {
    await this.queue.removeJobScheduler(this.buildSchedulerId(taskId));
  }

  /**
   * 按`installationId`移除Schedulers安装记录；把变更持久化到当前存储（`taskRepository.update`）。
   * @param installationId - 用于精确定位安装记录的标识。
   */
  async removeSchedulersForInstallation(installationId: string) {
    const tasks = await this.taskRepository.find({ where: { installationId } });
    for (const task of tasks) {
      await this.removeTaskScheduler(task.id);
    }
    await this.taskRepository.update(
      { installationId },
      { nextRunAt: null, runtimeStatus: 'disabled' },
    );
  }

  /**
   * 将一次手动插件任务加入队列，并禁用自动重试且在完成后清理作业。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于enqueue手动执行的结构化输入。
   * @returns enqueue手动执行。
   */
  async enqueueManualRun(taskId: string, input: Record<string, unknown>) {
    return this.queue.add(
      QQBOT_PLUGIN_TASK_JOB_NAME,
      {
        input,
        taskId,
        triggerType: 'manual',
      },
      {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  /**
   * 按 ``plugin-task:${taskId}`` 计算并返回结果。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 按参数编码并拼接完成的任务调度器标识。
   */
  private buildSchedulerId(taskId: string) {
    return `plugin-task:${taskId}`;
  }

  /**
   * 按当前运行态读取可调度任务Tasks；从 `getMany` 读取可调度任务Tasks。
   * @returns 可调度任务Tasks。
   */
  private findSchedulableTasks() {
    return this.createSchedulableTaskQuery().getMany();
  }

  /**
   * 按当前运行态读取不可调度任务启用状态Tasks；把变更持久化到当前存储（`taskRepository.createQueryBuilder`）。
   * @returns 不可调度任务启用状态Tasks。
   */
  private findUnschedulableEnabledTasks() {
    return this.taskRepository
      .createQueryBuilder('task')
      .innerJoin(
        'qqbot_plugin_installation',
        'installation',
        'installation.id = task.installation_id',
      )
      .where('task.enabled = :enabled', { enabled: true })
      .andWhere('installation.status <> :status', { status: 'enabled' })
      .getMany();
  }

  /**
   * 根据`taskId`与当前约束判定任务可调度任务；从 `getCount` 读取任务可调度任务。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 满足任务可调度任务约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async isTaskSchedulable(taskId: string) {
    const count = await this.createSchedulableTaskQuery()
      .andWhere('task.id = :taskId', { taskId })
      .getCount();
    return count > 0;
  }

  /**
   * 通过 `andWhere` 筛选匹配数据。
   * @returns 可调度任务Query。
   */
  private createSchedulableTaskQuery() {
    return this.taskRepository
      .createQueryBuilder('task')
      .innerJoin(
        'qqbot_plugin_installation',
        'installation',
        'installation.id = task.installation_id',
      )
      .where('task.enabled = :enabled', { enabled: true })
      .andWhere('installation.status = :status', { status: 'enabled' });
  }
}

export const QQBOT_PLUGIN_TASK_QUEUE_NAME = 'qqbot-plugin-task';
export const QQBOT_PLUGIN_TASK_JOB_NAME = 'execute-plugin-task';

/**
 * 按`configService`读取Qqbot插件任务QueuePrefix；从 `readStringConfig` 读取Qqbot插件任务QueuePrefix。
 * @param configService - 读取Qqbot插件任务QueuePrefix所需运行配置的配置服务。
 * @returns Qqbot插件任务QueuePrefix。
 */
export function readQqbotPluginTaskQueuePrefix(configService: ConfigService) {
  return readStringConfig(
    configService,
    [
      'QQBOT_PLUGIN_TASK_QUEUE_REDIS_PREFIX',
      'QQBOT_PLUGIN_TASK_QUEUE_PREFIX',
      'QQBOT_PLUGIN_QUEUE_REDIS_PREFIX',
    ],
    'kt:qqbot:plugin-task',
  );
}

/**
 * 从`configService`解析Qqbot插件任务Queue连接；从 `readStringConfig` 读取Qqbot插件任务Queue连接。
 * @param configService - 读取Qqbot插件任务Queue连接所需运行配置的配置服务。
 * @returns 包含 `db`、`host`、`password`、`port` 字段的Qqbot插件任务Queue连接。
 * @throws 当 `!host` 成立时拒绝当前输入并抛出 `Error`。
 */
export function resolveQqbotPluginTaskQueueConnection(
  configService: ConfigService,
): ConnectionOptions {
  const host = readStringConfig(configService, [
    'QQBOT_PLUGIN_TASK_QUEUE_REDIS_HOST',
    'QQBOT_PLUGIN_QUEUE_REDIS_HOST',
    'REDIS_HOST',
  ]);
  if (!host) {
    throw new Error('QQBot 插件定时任务队列缺少 Redis 主机配置');
  }

  const password = readStringConfig(configService, [
    'QQBOT_PLUGIN_TASK_QUEUE_REDIS_PASSWORD',
    'QQBOT_PLUGIN_QUEUE_REDIS_PASSWORD',
    'REDIS_PASSWORD',
  ]);

  return {
    db: readNumberConfig(
      configService,
      [
        'QQBOT_PLUGIN_TASK_QUEUE_REDIS_DB',
        'QQBOT_PLUGIN_QUEUE_REDIS_DB',
        'REDIS_DB',
      ],
      0,
    ),
    host,
    password: password || undefined,
    port: readNumberConfig(
      configService,
      [
        'QQBOT_PLUGIN_TASK_QUEUE_REDIS_PORT',
        'QQBOT_PLUGIN_QUEUE_REDIS_PORT',
        'REDIS_PORT',
      ],
      6379,
    ),
  };
}

/**
 * 按`configService`、`keys`、`fallback`读取字符串配置；当 `value !== undefined && value !== null && `${value}`.trim()` 成立时返回 ``${value}`.trim()`。
 * @param configService - 读取字符串配置所需运行配置的配置服务。
 * @param keys - 决定字符串配置内容、边界或目标的 `keys` 值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
 * @returns 字符串配置。
 */
function readStringConfig(
  configService: ConfigService,
  keys: string[],
  fallback = '',
) {
  for (const key of keys) {
    const value = configService.get<string | number | undefined>(key);
    if (value !== undefined && value !== null && `${value}`.trim()) {
      return `${value}`.trim();
    }
  }
  return fallback;
}

/**
 * 按`configService`、`keys`、`fallback`读取数值配置；当 `Number.isFinite(parsed)` 成立时返回 `parsed`。
 * @param configService - 读取数值配置所需运行配置的配置服务。
 * @param keys - 决定数值配置内容、边界或目标的 `keys` 值。
 * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
 * @returns 数值配置。
 */
function readNumberConfig(
  configService: ConfigService,
  keys: string[],
  fallback: number,
) {
  const value = readStringConfig(configService, keys);
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

/**
 * 通过 `toDate` 收敛领域表示。
 * @param cronExpression - 决定下次运行时间Qqbot插件任务内容、边界或目标的 `cronExpression` 值。
 * @returns 下次运行时间Qqbot插件任务。
 */
export function resolveNextQqbotPluginTaskRunAt(cronExpression: string) {
  return parseExpression(cronExpression).next().toDate();
}
