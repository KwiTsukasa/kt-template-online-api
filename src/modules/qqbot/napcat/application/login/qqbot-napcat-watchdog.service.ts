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

/**
 * NapCat 离线看门狗：定时主动巡检在线账号，及时发现掉线/被踢并触发既有站内信告警。
 * 不依赖 @nestjs/schedule，采用 OnModuleInit + setInterval（与代码库既有定时器一致）。
 * 仅检测 + 告警，自动重登由容器运行时适配器负责。
 */
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

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.accountService.runOfflineWatchdog();
    } catch (err) {
      this.logger.warn(
        `NapCat 离线看门狗巡检失败：${
          err instanceof Error ? err.message : `${err}`
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private isEnabled() {
    const value = `${
      this.configService.get<string>('QQBOT_NAPCAT_WATCHDOG_ENABLED') ?? 'true'
    }`
      .trim()
      .toLowerCase();
    return value !== 'false' && value !== '0' && value !== 'off';
  }

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
