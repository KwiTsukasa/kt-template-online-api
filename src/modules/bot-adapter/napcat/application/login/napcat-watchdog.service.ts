import { Injectable, Logger } from '@nestjs/common';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';

@Injectable()
export class NapcatWatchdogService {
  private readonly logger = new Logger(NapcatWatchdogService.name);
  private running = false;

  constructor(
    private readonly accountService: BotAccountService,
  ) {}

  /**
   * 串行核对既有账户离线状态，错误交给统一任务运行记录，退出时释放进程内占用。
   * @throws 账户巡检失败时保留领域错误并记录任务失败。
   */
  async inspectOffline(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.accountService.runOfflineWatchdog();
    } catch (err) {
      this.logger.warn(
        `NapCat 离线看门狗巡检失败：${(() => {
          if (err instanceof Error) {
            return err.message;
          }
          return `${err}`;
        })()}`,
      );
      throw err;
    } finally {
      this.running = false;
    }
  }

}
