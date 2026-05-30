import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

@Injectable()
export class QqbotRateLimitService {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  assertCanSend(selfId: string, targetId: string) {
    const now = Date.now();
    const globalKey = `${selfId}:global`;
    const targetKey = `${selfId}:${targetId}`;
    const minInterval = Math.ceil(1000 / this.getRatePerSecond());

    this.assertInterval(globalKey, now, minInterval, 'QQBot 全局发送过快');
    this.assertInterval(targetKey, now, 1000, 'QQBot 单会话发送过快');

    this.lastSentAt.set(globalKey, now);
    this.lastSentAt.set(targetKey, now);
  }

  private assertInterval(
    key: string,
    now: number,
    minInterval: number,
    msg: string,
  ) {
    const last = this.lastSentAt.get(key) || 0;
    if (now - last < minInterval) {
      throwVbenError(msg);
    }
  }

  private getRatePerSecond() {
    const value = Number(
      this.configService.get('QQBOT_SEND_RATE_PER_SECOND') || 1,
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
}
