import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ScheduleControlService } from '../application/schedule-control.service';
import { ScheduleDispatchService } from '../application/schedule-dispatch.service';

@Injectable()
export class ScheduleRecoveryWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ScheduleRecoveryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private stopped = false;
  private cursor = '0';
  constructor(
    private readonly control: ScheduleControlService,
    private readonly dispatch: ScheduleDispatchService,
  ) {}

  async onApplicationBootstrap() {
    await this.poll();
    this.timer = setInterval(() => void this.poll(), 1000);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.polling;
  }

  /**
   * 分批恢复计划控制与事件消费，单个计划失败不会阻塞其他计划的持久事件。
   * @returns 本轮有界计划扫描结束后返回。
   */
  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    if (this.stopped) return Promise.resolve();
    this.polling = (async () => {
      try {
        const ids = await this.control.pendingScheduleIds(this.cursor);
        for (const id of ids) {
          if (this.stopped) break;
          try {
            await this.control.reconcile(id);
            await this.dispatch.process(id);
          } catch (error) {
            this.logger.error(`计划 ${id} 恢复失败`, error);
          }
        }
        this.cursor = '0';
        if (ids.length === 100) this.cursor = ids[ids.length - 1];
      } catch (error) {
        this.logger.error('计划恢复扫描失败', error);
      } finally {
        this.polling = undefined;
      }
    })();
    return this.polling;
  }
}
