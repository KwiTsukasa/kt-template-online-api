import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

@Injectable()
export class QqbotRateLimitService {
  private readonly globalReservedAt = new Map<string, number[]>();
  private readonly targetReservedAt = new Map<string, number>();

  /**
   * 初始化 QqbotRateLimitService 实例。
   * @param configService - Nest ConfigService 依赖；影响 constructor 的返回值。
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param targetId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param targetId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   * @param targetId - QQBot ID；定位本次读取、更新、删除或关联的QQBot。
   * @param now - now 输入；驱动 `this.getNextTargetAvailableAt()`、`Math.max()`、`this.getNextGlobalAvailableAt()` 的 QQBot步骤。
   */
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

  /**
   * 执行 QQBot 核心流程。
   * @param slot - slot 输入；使用 `globalKey`、`nextAt`、`targetKey` 字段生成结果。
   */
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

  /**
   * 查询 QQBot 核心数据。
   * @param key - 键名；限定 QQBot查询范围。
   * @param intervalMs - QQBot列表；限定 QQBot查询范围。
   * @param now - now 输入；限定 QQBot查询范围。
   */
  private getFreshGlobalReservations(
    key: string,
    intervalMs: number,
    now: number,
  ) {
    return (this.globalReservedAt.get(key) || []).filter(
      (reservedAt) => reservedAt >= now - intervalMs,
    );
  }

  /**
   * 查询 QQBot 核心数据。
   * @param key - 键名；驱动 `this.getFreshGlobalReservations()` 的 QQBot步骤。
   * @param earliestAt - earliestAt 输入；限定 QQBot查询范围。
   * @param intervalMs - QQBot列表；驱动 `this.getFreshGlobalReservations()` 的 QQBot步骤。
   * @param now - now 输入；驱动 `this.getFreshGlobalReservations()` 的 QQBot步骤。
   */
  private getNextGlobalAvailableAt(
    key: string,
    earliestAt: number,
    intervalMs: number,
    now: number,
  ) {
    let candidateAt = earliestAt;
    const reserved = this.getFreshGlobalReservations(key, intervalMs, now).sort(
      (first, second) => first - second,
    );

    for (const reservedAt of reserved) {
      if (Math.abs(candidateAt - reservedAt) < intervalMs) {
        candidateAt = reservedAt + intervalMs;
      }
    }

    return candidateAt;
  }

  /**
   * 查询 QQBot 核心数据。
   * @param key - 键名；驱动 `targetReservedAt.get()` 的 QQBot步骤。
   * @param intervalMs - QQBot列表；限定 QQBot查询范围。
   * @param now - now 输入；限定 QQBot查询范围。
   */
  private getNextTargetAvailableAt(
    key: string,
    intervalMs: number,
    now: number,
  ) {
    const last = this.targetReservedAt.get(key);
    return last === undefined ? now : last + intervalMs;
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getGlobalIntervalMs() {
    const configured = this.getPositiveInteger('QQBOT_SEND_GLOBAL_INTERVAL_MS');
    if (configured) return configured;
    return Math.max(2500, Math.ceil(1000 / this.getRatePerSecond()));
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getTargetIntervalMs() {
    return this.getPositiveInteger('QQBOT_SEND_TARGET_INTERVAL_MS') || 8000;
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getJitterMs() {
    const max = this.getPositiveInteger('QQBOT_SEND_JITTER_MS') ?? 800;
    return max > 0 ? Math.floor(Math.random() * (max + 1)) : 0;
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getMaxQueueWaitMs() {
    return this.getPositiveInteger('QQBOT_SEND_MAX_QUEUE_WAIT_MS') || 30000;
  }

  /**
   * 查询 QQBot 核心数据。
   */
  private getRatePerSecond() {
    const value = Number(
      this.configService.get('QQBOT_SEND_RATE_PER_SECOND') || 1,
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  /**
   * 查询 QQBot 核心数据。
   * @param key - 键名；驱动 `Number()` 的 QQBot步骤。
   */
  private getPositiveInteger(key: string) {
    const value = Number(this.configService.get(key));
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
}
