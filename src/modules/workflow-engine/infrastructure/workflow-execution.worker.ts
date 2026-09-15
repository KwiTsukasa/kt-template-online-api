import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { automationQueueConnection } from '@/common/automation/queue.connection';
import { WorkflowExecutionService } from '../application/workflow-execution.service';

@Injectable()
export class WorkflowExecutionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowExecutionWorker.name);
  private queue?: Queue<{ runId: string }>;
  private worker?: Worker<{ runId: string }>;
  private timer?: ReturnType<typeof setInterval>;
  private pumping?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly config: ConfigService,
    private readonly execution: WorkflowExecutionService,
  ) {}

  async onApplicationBootstrap() {
    const options = automationQueueConnection(this.config);
    this.queue = new Queue('workflow-run', options);
    this.worker = new Worker(
      'workflow-run',
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
    this.timer = setInterval(() => void this.pump(), 500);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.pumping;
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * 将到期流程投递为短时推进消息，等待节点的长延迟以数据库唤醒时间恢复。
   * @returns 本轮恢复投递结束后返回。
   */
  private pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    if (this.stopped) return Promise.resolve();
    this.pumping = (async () => {
      try {
        for (const runId of await this.execution.pendingRunIds()) {
          if (this.stopped) break;
          await this.queue?.add(
            'advance',
            { runId },
            {
              jobId: `workflow-${runId}`,
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
        }
      } catch (error) {
        this.logger.error('流程恢复消息投递失败', error);
      } finally {
        this.pumping = undefined;
      }
    })();
    return this.pumping;
  }
}
