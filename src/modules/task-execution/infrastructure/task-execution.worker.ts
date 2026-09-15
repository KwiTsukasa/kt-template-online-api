import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { automationQueueConnection } from '@/common/automation/queue.connection';
import { TaskExecutionService } from '../application/task-execution.service';

@Injectable()
export class TaskExecutionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TaskExecutionWorker.name);
  private queue?: Queue<{ runId: string }>;
  private worker?: Worker<{ runId: string }>;
  private timer?: ReturnType<typeof setInterval>;
  private pumping?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly config: ConfigService,
    private readonly execution: TaskExecutionService,
  ) {}

  async onApplicationBootstrap() {
    const options = automationQueueConnection(this.config);
    this.queue = new Queue('atomic-task', options);
    this.worker = new Worker(
      'atomic-task',
      async (job) => this.execution.process(job.data.runId),
      { ...options, concurrency: 4 },
    );
    this.worker.on('error', (error) => this.logger.error(error.message));
    this.queue.on('error', (error) => this.logger.error(error.message));
    await Promise.all([
      this.queue.waitUntilReady(),
      this.worker.waitUntilReady(),
    ]);
    await this.pump();
    this.timer = setInterval(() => void this.pump(), 1000);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.pumping;
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * 将数据库待执行记录重新投递到队列；计时器只恢复基础执行消息，不拥有业务触发计划。
   * @returns 本轮有界投递结束后返回。
   */
  private pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    if (this.stopped) return Promise.resolve();
    this.pumping = (async () => {
      try {
        for (const runId of await this.execution.pendingRunIds()) {
          if (this.stopped) break;
          await this.queue?.add(
            'execute',
            { runId },
            {
              jobId: `task-${runId}`,
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        }
      } catch (error) {
        this.logger.error('原子任务待执行消息恢复失败', error);
      } finally {
        this.pumping = undefined;
      }
    })();
    return this.pumping;
  }
}
