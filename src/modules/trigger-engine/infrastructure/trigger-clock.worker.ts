import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { TriggerOccurrenceService } from '../application/trigger-occurrence.service';

@Injectable()
export class TriggerClockWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TriggerClockWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private stopped = false;
  constructor(private readonly occurrences: TriggerOccurrenceService) {}

  async onApplicationBootstrap() {
    await this.poll();
    this.timer = setInterval(() => void this.poll(), 500);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.polling;
  }

  /**
   * 唤醒持久触发游标扫描，避免同一进程重入；多个进程由注册行锁协调。
   * @returns 当前有界扫描完成后返回，失败保留原游标供下一次恢复。
   */
  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    if (this.stopped) return Promise.resolve();
    this.polling = this.occurrences
      .recordDue()
      .then(
        () => {},
        (error) => {
          this.logger.error('触发发生记录生成失败', error);
        },
      )
      .finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }
}
