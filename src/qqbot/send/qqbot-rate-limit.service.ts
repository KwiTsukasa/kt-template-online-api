import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

@Injectable()
export class QqbotRateLimitService {
  private readonly globalReservedAt = new Map<string, number[]>();
  private readonly targetReservedAt = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  async waitForSendSlot(selfId: string, targetId: string) {
    const now = Date.now();
    const slot = this.planSendSlot(selfId, targetId, now);
    const waitMs = slot.nextAt - now;
    if (waitMs > this.getMaxQueueWaitMs()) {
      throwVbenError('QQBot 发送队列繁忙，请稍后再试');
    }
    this.commitSendSlot(slot);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return { waitMs };
  }

  assertCanSend(selfId: string, targetId: string) {
    const now = Date.now();
    const minInterval = this.getGlobalIntervalMs();
    const globalKey = `${selfId}:global`;
    const targetKey = `${selfId}:${targetId}`;
    const globalNextAt = this.getNextGlobalAvailableAt(
      globalKey,
      now,
      minInterval,
      now,
    );
    const targetNextAt = this.getNextTargetAvailableAt(
      targetKey,
      this.getTargetIntervalMs(),
      now,
    );

    if (globalNextAt > now) throwVbenError('QQBot 全局发送过快');
    if (targetNextAt > now) throwVbenError('QQBot 单会话发送过快');

    this.commitSendSlot({ globalKey, nextAt: now, targetKey });
  }

  private planSendSlot(selfId: string, targetId: string, now: number) {
    const globalKey = `${selfId}:global`;
    const targetKey = `${selfId}:${targetId}`;
    const targetAvailableAt = this.getNextTargetAvailableAt(
      targetKey,
      this.getTargetIntervalMs(),
      now,
    );
    const baseAt = Math.max(now, targetAvailableAt);
    const jitterMs = baseAt > now ? this.getJitterMs() : 0;
    const nextAt = this.getNextGlobalAvailableAt(
      globalKey,
      baseAt + jitterMs,
      this.getGlobalIntervalMs(),
      now,
    );
    return { globalKey, nextAt, targetKey };
  }

  private commitSendSlot(slot: {
    globalKey: string;
    nextAt: number;
    targetKey: string;
  }) {
    const globalIntervalMs = this.getGlobalIntervalMs();
    const reserved = this.getFreshGlobalReservations(
      slot.globalKey,
      globalIntervalMs,
      Date.now(),
    );
    reserved.push(slot.nextAt);
    reserved.sort((first, second) => first - second);
    this.globalReservedAt.set(slot.globalKey, reserved);
    this.targetReservedAt.set(slot.targetKey, slot.nextAt);
  }

  private getFreshGlobalReservations(
    key: string,
    intervalMs: number,
    now: number,
  ) {
    return (this.globalReservedAt.get(key) || []).filter(
      (reservedAt) => reservedAt >= now - intervalMs,
    );
  }

  private getNextGlobalAvailableAt(
    key: string,
    earliestAt: number,
    intervalMs: number,
    now: number,
  ) {
    let candidateAt = earliestAt;
    const reserved = this.getFreshGlobalReservations(
      key,
      intervalMs,
      now,
    ).sort((first, second) => first - second);

    for (const reservedAt of reserved) {
      if (Math.abs(candidateAt - reservedAt) < intervalMs) {
        candidateAt = reservedAt + intervalMs;
      }
    }

    return candidateAt;
  }

  private getNextTargetAvailableAt(
    key: string,
    intervalMs: number,
    now: number,
  ) {
    const last = this.targetReservedAt.get(key);
    return last === undefined ? now : last + intervalMs;
  }

  private getGlobalIntervalMs() {
    const configured = this.getPositiveInteger('QQBOT_SEND_GLOBAL_INTERVAL_MS');
    if (configured) return configured;
    return Math.max(2500, Math.ceil(1000 / this.getRatePerSecond()));
  }

  private getTargetIntervalMs() {
    return this.getPositiveInteger('QQBOT_SEND_TARGET_INTERVAL_MS') || 8000;
  }

  private getJitterMs() {
    const max = this.getPositiveInteger('QQBOT_SEND_JITTER_MS') ?? 800;
    return max > 0 ? Math.floor(Math.random() * (max + 1)) : 0;
  }

  private getMaxQueueWaitMs() {
    return this.getPositiveInteger('QQBOT_SEND_MAX_QUEUE_WAIT_MS') || 30000;
  }

  private getRatePerSecond() {
    const value = Number(
      this.configService.get('QQBOT_SEND_RATE_PER_SECOND') || 1,
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  private getPositiveInteger(key: string) {
    const value = Number(this.configService.get(key));
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
}
