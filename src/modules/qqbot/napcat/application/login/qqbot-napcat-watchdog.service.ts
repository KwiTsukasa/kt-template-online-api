import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';

const DEFAULT_INTERVAL_MS = 120_000;
const MIN_INTERVAL_MS = 30_000;

@Injectable()
export class QqbotNapcatWatchdogService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(QqbotNapcatWatchdogService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: QqbotAccountService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;

    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    this.logger.log(`NapCat 离线看门狗已启用，巡检间隔 ${intervalMs}ms`);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * 将本次操作写入 `this.running` 状态。
   */
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.accountService.runOfflineWatchdog();
    } catch (err) {
      this.logger.warn(
        `NapCat 离线看门狗巡检失败：${
          (() => {
            if (err instanceof Error) {
              return err.message;
            }
            return `${err}`;
          })()
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * 根据当前运行态与当前约束判定启用状态；从 `configService.get` 读取启用状态。
   * @returns 满足启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isEnabled() {
    const value = `${
      this.configService.get<string>('QQBOT_NAPCAT_WATCHDOG_ENABLED') ?? 'true'
    }`
      .trim()
      .toLowerCase();
    return value !== 'false' && value !== '0' && value !== 'off';
  }

  /**
   * 按当前运行态读取间隔Ms；当 `!Number.isFinite(value) || value < MIN_INTERVAL_MS` 成立时返回 `DEFAULT_INTERVAL_MS`。
   * @returns 间隔Ms。
   */
  private getIntervalMs() {
    const value = Number(
      this.configService.get<string>('QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS') ||
        DEFAULT_INTERVAL_MS,
    );
    if (!Number.isFinite(value) || value < MIN_INTERVAL_MS) {
      return DEFAULT_INTERVAL_MS;
    }
    return value;
  }
}
