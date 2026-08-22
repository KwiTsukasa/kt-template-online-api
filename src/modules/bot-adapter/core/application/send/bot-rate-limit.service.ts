import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwVbenError } from '@/common';

@Injectable()
export class BotRateLimitService {
  private readonly globalReservedAt = new Map<string, number[]>();
  private readonly targetReservedAt = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * 根据`selfId`、`targetId`计算并预留发送时隙；等待超过配置上限时拒绝，否则延迟到可用时间；从 `getMaxQueueWaitMs` 读取发送时隙。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param targetId - 用于精确定位target的标识。
   * @returns 包含 `waitMs` 字段的发送时隙。
   */
  async waitForSendSlot(selfId: string, targetId: string) {
    const now = Date.now();
    const slot = this.planSendSlot(selfId, targetId, now);
    const waitMs = slot.nextAt - now;
    if (waitMs > this.getMaxQueueWaitMs()) {
      throwVbenError('Bot 发送队列繁忙，请稍后再试');
    }
    this.commitSendSlot(slot);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return { waitMs };
  }

  /**
   * 校验`selfId`、`targetId`是否满足`assertCanSend` 对应结果约束，并拒绝不合法输入；从 `getGlobalIntervalMs` 读取`assertCanSend` 对应结果。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param targetId - 用于精确定位target的标识。
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

    if (globalNextAt > now) throwVbenError('Bot 全局发送过快');
    if (targetNextAt > now) throwVbenError('Bot 单会话发送过快');

    this.commitSendSlot({ globalKey, nextAt: now, targetKey });
  }

  /**
   * 根据`selfId`、`targetId`、`now`处理plan发送时隙；从 `getNextTargetAvailableAt` 读取plan发送时隙。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @param targetId - 用于精确定位target的标识。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 包含 `globalKey`、`nextAt`、`targetKey` 字段的plan发送时隙。
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
    const jitterMs = (() => {
      if (baseAt > now) {
        return this.getJitterMs();
      }
      return 0;
    })();
    const nextAt = this.getNextGlobalAvailableAt(
      globalKey,
      baseAt + jitterMs,
      this.getGlobalIntervalMs(),
      now,
    );
    return { globalKey, nextAt, targetKey };
  }

  /**
   * 根据`slot`处理commit发送时隙；从 `getGlobalIntervalMs` 读取commit发送时隙。
   * @param slot - 用于commit发送时隙的领域对象，包含 `globalKey`、`nextAt`、`targetKey` 字段。
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
   * 通过 `filter` 筛选匹配数据。
   * @param key - 用于读取或更新有效Global预留集合的稳定键。
   * @param intervalMs - 用于有效Global预留集合超时、有效期或退避计算的毫秒数。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 有效Global预留集合。
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
   * 按`key`、`earliestAt`、`intervalMs`读取下次运行时间GlobalAvailable；从 `getFreshGlobalReservations` 读取下次运行时间GlobalAvailable。
   * @param key - 用于读取或更新下次运行时间GlobalAvailable的稳定键。
   * @param earliestAt - 用于过期、排序或租约判定的时间基准。
   * @param intervalMs - 用于下次运行时间GlobalAvailable超时、有效期或退避计算的毫秒数。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 下次运行时间GlobalAvailable。
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
   * 按`key`、`intervalMs`、`now`读取下次运行时间TargetAvailable；当 `last === undefined` 成立时返回 `now`。
   * @param key - 用于读取或更新下次运行时间TargetAvailable的稳定键。
   * @param intervalMs - 用于下次运行时间TargetAvailable超时、有效期或退避计算的毫秒数。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 下次运行时间TargetAvailable。
   */
  private getNextTargetAvailableAt(
    key: string,
    intervalMs: number,
    now: number,
  ) {
    const last = this.targetReservedAt.get(key);
    if (last === undefined) {
      return now;
    }
    return last + intervalMs;
  }

  /**
   * 按当前运行态读取Global间隔Ms；从 `getPositiveInteger` 读取Global间隔Ms。
   * @returns Global间隔Ms。
   */
  private getGlobalIntervalMs() {
    const configured = this.getPositiveInteger('BOT_SEND_GLOBAL_INTERVAL_MS');
    if (configured) return configured;
    return Math.max(2500, Math.ceil(1000 / this.getRatePerSecond()));
  }

  /**
   * 按当前运行态读取Target间隔Ms；从 `getPositiveInteger` 读取Target间隔Ms。
   * @returns 规范化后的Target间隔Ms；主值为空时采用 `8000` 兜底。
   */
  private getTargetIntervalMs() {
    return this.getPositiveInteger('BOT_SEND_TARGET_INTERVAL_MS') || 8000;
  }

  /**
   * 按当前运行态读取JitterMs；当 `max > 0` 成立时返回 `Math.floor(Math.random() * (max + 1))`。
   * @returns 当前状态对应的JitterMs，取值为 `0`。
   */
  private getJitterMs() {
    const max = this.getPositiveInteger('BOT_SEND_JITTER_MS') ?? 800;
    if (max > 0) {
      return Math.floor(Math.random() * (max + 1));
    }
    return 0;
  }

  /**
   * 按当前运行态读取最大QueueMs；从 `getPositiveInteger` 读取最大QueueMs。
   * @returns 规范化后的最大QueueMs；主值为空时采用 `30000` 兜底。
   */
  private getMaxQueueWaitMs() {
    return this.getPositiveInteger('BOT_SEND_MAX_QUEUE_WAIT_MS') || 30000;
  }

  /**
   * 按当前运行态读取Rate每秒值Second；当 `Number.isFinite(value) && value > 0` 成立时返回 `value`。
   * @returns 当前状态对应的Rate每秒值Second，取值为 `1`。
   */
  private getRatePerSecond() {
    const value = Number(
      this.configService.get('BOT_SEND_RATE_PER_SECOND') || 1,
    );
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return 1;
  }

  /**
   * 按`key`读取Positive整数；当 `Number.isInteger(value) && value >= 0` 成立时返回 `value`。
   * @param key - 用于读取或更新Positive整数的稳定键。
   * @returns Positive整数；没有可用结果或提前结束时为 `undefined`。
   */
  private getPositiveInteger(key: string) {
    const value = Number(this.configService.get(key));
    if (Number.isInteger(value) && value >= 0) {
      return value;
    }
    return undefined;
  }
}
