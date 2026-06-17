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
        error instanceof Error ? error.message : `${error || ''}`;
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

  private async finishRun(
    run: QqbotPluginTaskRun,
    patch: Partial<QqbotPluginTaskRun>,
  ) {
    return this.runRepository.save({
      ...run,
      ...patch,
    });
  }

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
        runtimeStatus:
          result.status === 'failed'
            ? 'failed'
            : task.enabled
              ? 'scheduled'
              : 'idle',
      },
    );
  }

  private getOutputKeys(output: unknown) {
    return output && typeof output === 'object'
      ? Object.keys(output as Record<string, unknown>).sort()
      : [];
  }
}
