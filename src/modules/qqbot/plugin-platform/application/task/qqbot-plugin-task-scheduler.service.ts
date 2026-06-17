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

  async resyncEnabledTasks() {
    const tasks = await this.findSchedulableTasks();
    for (const task of tasks) {
      await this.syncTaskScheduler(task);
    }
  }

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

  async syncTaskScheduler(
    task: Pick<
      QqbotPluginTask,
      'cronExpression' | 'enabled' | 'id' | 'installationId' | 'taskKey' | 'timeoutMs'
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

  async removeTaskScheduler(taskId: string) {
    await this.queue.removeJobScheduler(this.buildSchedulerId(taskId));
  }

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

  private buildSchedulerId(taskId: string) {
    return `plugin-task:${taskId}`;
  }

  private findSchedulableTasks() {
    return this.createSchedulableTaskQuery().getMany();
  }

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

  private async isTaskSchedulable(taskId: string) {
    const count = await this.createSchedulableTaskQuery()
      .andWhere('task.id = :taskId', { taskId })
      .getCount();
    return count > 0;
  }

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

export function readQqbotPluginTaskQueuePrefix(
  configService: ConfigService,
) {
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

function readNumberConfig(
  configService: ConfigService,
  keys: string[],
  fallback: number,
) {
  const value = readStringConfig(configService, keys);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveNextQqbotPluginTaskRunAt(cronExpression: string) {
  return parseExpression(cronExpression).next().toDate();
}
