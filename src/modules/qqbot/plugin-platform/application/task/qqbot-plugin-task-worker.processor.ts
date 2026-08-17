import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { Repository } from 'typeorm';
import { QqbotPluginPlatformService } from '../plugin-platform.service';
import {
  QqbotPluginTask,
  QqbotPluginTaskRun,
  type QqbotPluginTaskRunStatus,
  type QqbotPluginTaskTriggerType,
} from '../../infrastructure/persistence';
import {
  QQBOT_PLUGIN_TASK_JOB_NAME,
  QQBOT_PLUGIN_TASK_QUEUE_NAME,
  readQqbotPluginTaskQueuePrefix,
  resolveQqbotPluginTaskQueueConnection,
  resolveNextQqbotPluginTaskRunAt,
  type QqbotPluginTaskJobData,
} from './qqbot-plugin-task-scheduler.service';

@Injectable()
export class QqbotPluginTaskWorkerProcessor
  implements OnModuleDestroy, OnModuleInit
{
  private readonly logger = new Logger(QqbotPluginTaskWorkerProcessor.name);
  private worker?: Worker<QqbotPluginTaskJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly platformService: QqbotPluginPlatformService,
    @InjectRepository(QqbotPluginTask)
    private readonly taskRepository: Repository<QqbotPluginTask>,
    @InjectRepository(QqbotPluginTaskRun)
    private readonly runRepository: Repository<QqbotPluginTaskRun>,
  ) {}

  async onModuleInit() {
    this.worker = new Worker<QqbotPluginTaskJobData>(
      QQBOT_PLUGIN_TASK_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        concurrency: 1,
        connection: resolveQqbotPluginTaskQueueConnection(this.configService),
        prefix: readQqbotPluginTaskQueuePrefix(this.configService),
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error(error.message, error.stack);
    });
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  /**
   * 根据`job`处理子进程Job；当 `job.name && job.name !== QQBOT_PLUGIN_TASK_JOB_NAME` 成立时返回 `{ ok: false, reason: 'unknown-job', skipped…`。
   * @param job - 用于子进程Job的领域对象，包含 `name`、`data`、`id` 字段。
   * @returns 子进程Job。
   */
  private async processJob(job: Job<QqbotPluginTaskJobData>) {
    if (job.name && job.name !== QQBOT_PLUGIN_TASK_JOB_NAME) {
      return { ok: false, reason: 'unknown-job', skipped: true };
    }

    const task = await this.taskRepository.findOne({
      where: { id: job.data.taskId },
    });
    if (!task) {
      return { ok: false, reason: 'task-not-found', skipped: true };
    }

    if (job.data.triggerType === 'schedule' && !task.enabled) {
      return this.writeSkippedRun(
        task,
        `${job.id || ''}`,
        job.data.triggerType,
        'task-disabled',
      );
    }
    if (
      job.data.triggerType === 'schedule' &&
      !(await this.isInstallationEnabled(task.id))
    ) {
      return this.writeSkippedRun(
        task,
        `${job.id || ''}`,
        job.data.triggerType,
        'installation-disabled',
      );
    }

    const running = await this.runRepository.findOne({
      where: { status: 'running', taskId: task.id },
    });
    if (running) {
      return this.writeSkippedRun(
        task,
        `${job.id || ''}`,
        job.data.triggerType,
        'previous-run-running',
      );
    }

    return this.executeTaskRun(
      task,
      `${job.id || ''}`,
      job.data.triggerType,
      job.data.input || {},
    );
  }

  /**
   * 根据`task`、`jobId`、`triggerType`处理任务；把变更持久化到当前存储（`runRepository.save`）。
   * @param task - 用于任务的领域对象，包含 `installationId`、`pluginId`、`id`、`taskKey` 字段。
   * @param jobId - 用于精确定位job的标识。
   * @param triggerType - 决定任务内容、边界或目标的 `triggerType` 值。
   * @param input - 用于任务的结构化输入。
   * @returns 包含 `ok`、`runId`、`status` 字段的任务。
   * @throws 当 `platformService.executeTask` 或 `startedAt.getTime` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async executeTaskRun(
    task: QqbotPluginTask,
    jobId: string,
    triggerType: QqbotPluginTaskTriggerType,
    input: Record<string, unknown>,
  ) {
    const startedAt = new Date();
    const run = await this.runRepository.save({
      installationId: task.installationId,
      jobId,
      pluginId: task.pluginId,
      safeSummary: {
        inputKeys: Object.keys(input).sort(),
      },
      startedAt,
      status: 'running',
      taskId: task.id,
      taskKey: task.taskKey,
      triggerType,
    });
    await this.taskRepository.update(
      { id: task.id },
      {
        lastRunId: run.id,
        runtimeStatus: 'running',
      },
    );

    try {
      const output = await this.platformService.executeTask({
        input,
        installationId: task.installationId,
        pluginId: task.pluginId,
        taskHandlerName: task.handlerName,
        taskId: task.id,
        taskKey: task.taskKey,
        timeoutMs: task.timeoutMs,
        triggerType,
      });
      const durationMs = Date.now() - startedAt.getTime();
      const finishedAt = new Date();
      const saved = await this.finishRun(run, {
        durationMs,
        finishedAt,
        safeSummary: {
          outputKeys: this.getOutputKeys(output),
        },
        status: 'success',
      });
      await this.finishTask(task, saved, {
        durationMs,
        errorMessage: null,
        finishedAt,
        status: 'success',
      });
      return {
        ok: true,
        runId: saved.id,
        status: 'success',
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt.getTime();
      const finishedAt = new Date();
      const errorMessage =
        (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return `${error || ''}`;
        })();
      const saved = await this.finishRun(run, {
        durationMs,
        errorMessage,
        finishedAt,
        status: 'failed',
      });
      await this.finishTask(task, saved, {
        durationMs,
        errorMessage,
        finishedAt,
        status: 'failed',
      });
      throw error;
    }
  }

  /**
   * 根据`task`、`jobId`、`triggerType`更新Skipped；把变更持久化到当前存储（`runRepository.save`）。
   * @param task - 用于Skipped的领域对象，包含 `installationId`、`pluginId`、`id`、`taskKey` 字段。
   * @param jobId - 用于精确定位job的标识。
   * @param triggerType - 决定Skipped内容、边界或目标的 `triggerType` 值。
   * @param reason - 决定Skipped内容、边界或目标的 `reason` 值。
   * @returns 包含 `ok`、`reason`、`runId`、`status` 字段的Skipped。
   */
  private async writeSkippedRun(
    task: QqbotPluginTask,
    jobId: string,
    triggerType: QqbotPluginTaskTriggerType,
    reason: string,
  ) {
    const now = new Date();
    const run = await this.runRepository.save({
      durationMs: 0,
      finishedAt: now,
      installationId: task.installationId,
      jobId,
      pluginId: task.pluginId,
      safeSummary: { reason },
      startedAt: now,
      status: 'skipped',
      taskId: task.id,
      taskKey: task.taskKey,
      triggerType,
    });
    await this.finishTask(task, run, {
      durationMs: 0,
      errorMessage: reason,
      finishedAt: now,
      status: 'skipped',
    });
    return {
      ok: true,
      reason,
      runId: run.id,
      status: 'skipped',
    };
  }

  /**
   * 将任务运行记录与终态补丁合并后持久化，并返回更新后的运行记录。
   * @param run - 决定完成状态内容、边界或目标的 `run` 值。
   * @param patch - 决定完成状态内容、边界或目标的 `patch` 值。
   * @returns 完成状态。
   */
  private async finishRun(
    run: QqbotPluginTaskRun,
    patch: Partial<QqbotPluginTaskRun>,
  ) {
    return this.runRepository.save({
      ...run,
      ...patch,
    });
  }

  /**
   * 根据`task`、`run`、`result`处理完成状态任务；把变更持久化到当前存储（`taskRepository.update`）。
   * @param task - 用于完成状态任务的领域对象，包含 `id`、`enabled` 字段。
   * @param run - 用于完成状态任务的领域对象，包含 `id` 字段。
   * @param result - 用于完成状态任务的领域对象，包含 `durationMs`、`errorMessage`、`finishedAt`、`status` 字段。
   */
  private async finishTask(
    task: QqbotPluginTask,
    run: QqbotPluginTaskRun,
    result: {
      durationMs: number;
      errorMessage: null | string;
      finishedAt: Date;
      status: QqbotPluginTaskRunStatus;
    },
  ) {
    await this.taskRepository.update(
      { id: task.id },
      {
        lastDurationMs: result.durationMs,
        lastError: result.errorMessage,
        lastRunAt: result.finishedAt,
        lastRunId: run.id,
        lastStatus: result.status,
        nextRunAt: this.resolveNextRunAt(task),
        runtimeStatus:
          (() => {
            if (result.status === 'failed') {
              return 'failed';
            }
            if (task.enabled) {
              return 'scheduled';
            }
            return 'idle';
          })(),
      },
    );
  }

  /**
   * 从`task`解析下次运行时间。
   * @param task - 用于下次运行时间的领域对象，包含 `enabled`、`cronExpression` 字段。
   * @returns 下次运行时间；无法解析或未命中时为 `null`。
   */
  private resolveNextRunAt(task: QqbotPluginTask) {
    if (!task.enabled || !task.cronExpression) return null;
    return resolveNextQqbotPluginTaskRunAt(task.cronExpression);
  }

  /**
   * 根据`taskId`与当前约束判定安装记录启用状态；把变更持久化到当前存储（`taskRepository.createQueryBuilder`）。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 满足安装记录启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async isInstallationEnabled(taskId: string) {
    const count = await this.taskRepository
      .createQueryBuilder('task')
      .innerJoin(
        'qqbot_plugin_installation',
        'installation',
        'installation.id = task.installation_id',
      )
      .where('task.id = :taskId', { taskId })
      .andWhere('installation.status = :status', { status: 'enabled' })
      .getCount();
    return count > 0;
  }

  /**
   * 按`output`读取OutputKeys；当 `output && typeof output === 'object'` 成立时返回 `Object.keys(output as Record<string, unknow…`。
   * @param output - 决定OutputKeys内容、边界或目标的 `output` 值。
   * @returns 按输入顺序得到的OutputKeys列表；没有匹配项时为空数组。
   */
  private getOutputKeys(output: unknown) {
    if (output && typeof output === 'object') {
      return Object.keys(output as Record<string, unknown>).sort();
    }
    return [];
  }
}
