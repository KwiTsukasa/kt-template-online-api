import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { KtDateTime } from '@/common';
import { SystemMessageContractError } from '@/modules/message-management/contract/message-management.types';
import { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import { QqbotMessageDelivery } from './qqbot-message-delivery.entity';
import { QqbotMessagePublishBinding } from './qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from './qqbot-message-publish-target.entity';
import {
  QqbotSendAttemptError,
  strictSendErrorSummary,
} from '@/modules/qqbot/core/application/send/qqbot-send.error';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_LEASE_MS,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_MAX_MS,
} from '@/modules/message-management/application/system-message-runner.constants';
import { SystemMessageTemplateRendererService } from '@/modules/message-management/application/system-message-template-renderer.service';

const DELIVERY_EXPIRED = 'delivery_expired';
const TRANSIENT_ERROR = 'delivery_transient_error';

type ClaimToken = {
  attempt: number;
  delivery: QqbotMessageDelivery;
  leaseUntil: KtDateTime;
};

type OwnerTransition = Pick<
  QqbotMessageDelivery,
  | 'lastErrorCode'
  | 'lastErrorMessage'
  | 'nextAttemptAt'
  | 'processingLeaseUntil'
  | 'sendLogId'
  | 'status'
>;

type PreparedDelivery =
  | { kind: 'send'; delivery: QqbotMessageDelivery }
  | { kind: 'stale' }
  | {
      code: string;
      kind: 'finish';
      status: 'cancelled' | 'failed' | 'superseded';
    };

/**
 * 按边界约束计算投递重试延迟毫秒。
 * @param attemptCount - 限制按边界约束计算投递重试延迟毫秒数量、尺寸、等级或重试边界的数值。
 * @returns 按边界约束计算投递重试延迟毫秒。
 */
export function deliveryRetryDelayMs(attemptCount: number): number {
  return Math.min(
    SYSTEM_MESSAGE_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
    SYSTEM_MESSAGE_RETRY_MAX_MS,
  );
}

@Injectable()
export class SystemMessageDeliveryRunnerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly templateRenderer: SystemMessageTemplateRendererService,
    private readonly sendService: QqbotSendService,
  ) {}

  /**
   * 在单批上限内依次领取并处理到期记录，队列暂空时提前停止并返回实际领取数量。
   * @param now - 用于过期、排序或租约判定的时间基准；为空时采用 `new Date()` 作为兜底。
   * @returns 返回本轮实际领取的记录数量；队列暂空时可为 `0`。
   */
  async runOnce(now?: Date): Promise<number> {
    let claimed = 0;
    for (let index = 0; index < SYSTEM_MESSAGE_BATCH_SIZE; index += 1) {
      const token = await this.claimOne(now ?? new Date());
      if (!token) break;
      claimed += 1;
      try {
        await this.processClaim(token, now);
      } catch {
        await this.handleUnexpectedClaimFailure(token, now ?? new Date());
      }
    }
    return claimed;
  }

  /**
   * 在悲观锁事务中跳过已锁记录，领取最早到期的事件或投递并写入新的处理租约。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 返回带新租约的事件或投递令牌；没有到期记录时为 `null`。
   */
  private async claimOne(now: Date): Promise<ClaimToken | null> {
    return this.dataSource.transaction(async (manager) => {
      const deliveries = manager.getRepository(QqbotMessageDelivery);
      const delivery = await deliveries
        .createQueryBuilder('delivery')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where(
          new Brackets((where) => {
            where
              .where(
                'delivery.status IN (:...due) AND delivery.nextAttemptAt <= :now',
                { due: ['pending', 'retry'], now },
              )
              .orWhere(
                'delivery.status = :processing AND delivery.processingLeaseUntil <= :now',
                { processing: 'processing', now },
              );
          }),
        )
        .orderBy('delivery.nextAttemptAt', 'ASC')
        .addOrderBy('delivery.id', 'ASC')
        .take(1)
        .getOne();
      if (!delivery) return null;
      const leaseUntil = new KtDateTime(
        now.getTime() + SYSTEM_MESSAGE_LEASE_MS,
      );
      delivery.attemptCount += 1;
      delivery.nextAttemptAt = null;
      delivery.processingLeaseUntil = leaseUntil;
      delivery.status = 'processing';
      await deliveries.save(delivery);
      return { attempt: delivery.attemptCount, delivery, leaseUntil };
    });
  }

  /**
   * 处理当前租约领取的消息记录，在过期、失去所有权或业务失败时结束、重试或标记失败。
   * @param token - 用于当前租约领取的消息记录，在过期、失去所有权或业务失败时结束、重试或标记失败的领域对象，包含 `delivery`、`attempt` 字段。
   * @param fixedNow - 用于过期、排序或租约判定的时间基准；为空时采用 `new Date()` 作为兜底。
   */
  private async processClaim(
    token: ClaimToken,
    fixedNow?: Date,
  ): Promise<void> {
    const preparationNow = fixedNow ?? new Date();
    if (preparationNow.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(
        token,
        'failed',
        DELIVERY_EXPIRED,
        'delivery deadline reached',
        null,
      );
      return;
    }
    const prepared = await this.prepare(token);
    if (prepared.kind === 'stale') return;
    if (prepared.kind === 'finish') {
      await this.finish(
        token,
        prepared.status,
        prepared.code,
        prepared.code,
        null,
      );
      return;
    }
    const sendNow = fixedNow ?? new Date();
    if (sendNow.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(
        token,
        'failed',
        DELIVERY_EXPIRED,
        'delivery deadline reached',
        null,
      );
      return;
    }
    try {
      const result = await this.sendService.sendStrictPlainText({
        attemptNumber: token.attempt,
        deliveryId: token.delivery.id,
        message: prepared.delivery.renderedMessage,
        selfId: prepared.delivery.selfId,
        targetId: prepared.delivery.targetId,
        targetType: prepared.delivery.targetType,
      });
      await this.finish(token, 'success', null, null, String(result.logId));
    } catch (error) {
      if (error instanceof QqbotSendAttemptError) {
        if (!error.retryable) {
          await this.finish(
            token,
            'failed',
            error.code,
            strictSendErrorSummary(error.code),
            error.sendLogId,
          );
          return;
        }
        await this.retryOrFail(
          token,
          fixedNow ?? new Date(),
          error.code,
          strictSendErrorSummary(error.code),
          error.sendLogId,
        );
        return;
      }
      await this.retryOrFail(
        token,
        fixedNow ?? new Date(),
        TRANSIENT_ERROR,
        'delivery transport unavailable',
        null,
      );
    }
  }

  /**
   * 根据`token`构造准备系统消息投递执行器记录。
   * @param token - 用于准备系统消息投递执行器记录的领域对象，包含 `delivery` 字段。
   * @returns 准备系统消息投递执行器记录。
   */
  private async prepare(token: ClaimToken): Promise<PreparedDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const binding = await manager
        .getRepository(QqbotMessagePublishBinding)
        .findOne({
          where: { id: token.delivery.bindingId },
          lock: { mode: 'pessimistic_read' },
        });
      const target = await manager
        .getRepository(QqbotMessagePublishTarget)
        .findOne({
          where: { id: token.delivery.publishTargetId },
          lock: { mode: 'pessimistic_read' },
        });
      const account = await (async () => {
        if (binding) {
          return await manager.getRepository(QqbotAccount).findOne({
            where: { id: binding.accountId },
            lock: { mode: 'pessimistic_read' },
          });
        }
        return null;
      })();
      const delivery = await manager
        .getRepository(QqbotMessageDelivery)
        .findOne({
          where: { id: token.delivery.id },
          lock: { mode: 'pessimistic_write' },
        });
      if (!delivery || !this.owns(delivery, token)) return { kind: 'stale' };
      if (delivery.targetType !== 'group' && delivery.targetType !== 'private')
        return {
          code: 'invalid_target_type',
          kind: 'finish',
          status: 'failed',
        };
      const cancelledConfiguration = {
        code: 'delivery_configuration_cancelled',
        kind: 'finish',
        status: 'cancelled',
      } as const;
      if (!binding || !target || !account) {
        return cancelledConfiguration;
      }
      if (binding.isDeleted || target.isDeleted || account.isDeleted) {
        return cancelledConfiguration;
      }
      if (!binding.enabled || !target.enabled || !account.enabled) {
        return cancelledConfiguration;
      }
      if (
        binding.subscriptionId !== delivery.subscriptionId ||
        target.bindingId !== delivery.bindingId
      ) {
        return cancelledConfiguration;
      }
      if (
        target.targetId !== delivery.targetId ||
        target.targetType !== delivery.targetType
      ) {
        return cancelledConfiguration;
      }
      if (
        binding.selfId !== delivery.selfId ||
        account.selfId !== delivery.selfId
      ) {
        return cancelledConfiguration;
      }
      try {
        this.validateFrozen(delivery);
      } catch (error) {
        if (!(error instanceof SystemMessageContractError)) throw error;
        return {
          code: error.code,
          kind: 'finish',
          status: 'failed',
        };
      }
      return { delivery, kind: 'send' };
    });
  }

  /**
   * 只按统一消息快照重放模板渲染，不再解析或调用任何消息源适配器。
   * @param delivery - 保存变量快照、模板内容和冻结渲染结果的投递记录。
   * @throws 快照不合法或重渲染结果与冻结文本不一致时抛出 `SystemMessageContractError`。
   */
  private validateFrozen(delivery: QqbotMessageDelivery): void {
    const snapshot = delivery.variableSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new SystemMessageContractError('template_invalid');
    }
    if (
      this.templateRenderer.render(
        delivery.templateContent,
        snapshot as Record<string, boolean | number | string>,
      ) !== delivery.renderedMessage
    )
      throw new SystemMessageContractError('rendered_message_mismatch');
  }

  /**
   * 根据`token`、`now`处理意外的声明失败。
   * @param token - 决定意外的声明失败内容、边界或目标的 `token` 值。
   * @param now - 用于过期、排序或租约判定的时间基准。
   */
  private async handleUnexpectedClaimFailure(
    token: ClaimToken,
    now: Date,
  ): Promise<void> {
    try {
      await this.retryOrFail(
        token,
        now,
        TRANSIENT_ERROR,
        'delivery dependency unavailable',
        null,
      );
    } catch {
      // A later scan recovers the still-processing row after its lease expires.
    }
  }

  /**
   * 仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约。
   * @param token - 用于仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约的领域对象，包含 `delivery` 字段。
   * @param status - 决定仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约内容、边界或目标的 `status` 值。
   * @param code - 决定仅在当前租约条件仍匹配时把消息事件或投递更新为指定终态，避免旧执行者覆盖新租约内容、边界或目标的 `code` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @param sendLogId - 用于精确定位日志的标识。
   * @param nextAttemptAt - 用于过期、排序或租约判定的时间基准；省略时默认采用 `null`。
   */
  private async finish(
    token: ClaimToken,
    status: 'cancelled' | 'failed' | 'success' | 'superseded',
    code: null | string,
    message: null | string,
    sendLogId: null | string,
    nextAttemptAt: KtDateTime | null = null,
  ): Promise<void> {
    await this.persistOwnerTransition(token, {
      lastErrorCode: code,
      lastErrorMessage: message,
      nextAttemptAt,
      processingLeaseUntil: null,
      sendLogId: sendLogId ?? token.delivery.sendLogId,
      status,
    });
  }

  /**
   * 按尝试次数计算下一次执行时间；超过事件或投递期限时直接标记失败，否则安排重试。
   * @param token - 用于按尝试次数计算下一次执行时间的领域对象，包含 `attempt`、`delivery` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @param code - 决定按尝试次数计算下一次执行时间内容、边界或目标的 `code` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @param sendLogId - 用于精确定位日志的标识。
   */
  private async retryOrFail(
    token: ClaimToken,
    now: Date,
    code: string,
    message: string,
    sendLogId: null | string,
  ): Promise<void> {
    const next = new KtDateTime(
      now.getTime() + deliveryRetryDelayMs(token.attempt),
    );
    if (next.getTime() >= token.delivery.expiresAt.getTime()) {
      await this.finish(token, 'failed', code, message, sendLogId);
      return;
    }
    await this.persistOwnerTransition(token, {
      lastErrorCode: code,
      lastErrorMessage: message,
      nextAttemptAt: next,
      processingLeaseUntil: null,
      sendLogId: sendLogId ?? token.delivery.sendLogId,
      status: 'retry',
    });
  }

  /**
   * 根据`token`、`values`更新持久化所有者转换；从 `dataSource.getRepository` 读取持久化所有者转换。
   * @param token - 决定持久化所有者转换内容、边界或目标的 `token` 值。
   * @param values - 按原有顺序参与持久化所有者转换筛选、合并或汇总的集合。
   */
  private async persistOwnerTransition(
    token: ClaimToken,
    values: OwnerTransition,
  ): Promise<void> {
    const deliveries = this.dataSource.getRepository(QqbotMessageDelivery);
    const owner = this.ownerWhere(token);
    try {
      await deliveries.update(owner, values);
    } catch {
      try {
        await deliveries.update(owner, values);
      } catch {
        // A later scan recovers the lease if neither ambiguous write committed.
      }
    }
  }

  /**
   * 把投递标识、尝试次数、状态和租约截止时间组成仅命中当前处理所有者的更新条件。
   * @param token - 用于把投递标识、尝试次数、状态和租约截止时间组成仅命中当前处理所有者的更新条件的领域对象，包含 `attempt`、`delivery`、`leaseUntil` 字段。
   * @returns 返回仅匹配当前投递租约所有者的 TypeORM 更新条件。
   */
  private ownerWhere(token: ClaimToken) {
    return {
      attemptCount: token.attempt,
      id: token.delivery.id,
      processingLeaseUntil: token.leaseUntil,
      status: 'processing' as const,
    };
  }

  /**
   * 按租约标识和到期时间判定当前执行权。
   * @param delivery - 用于按租约标识和到期时间判定当前执行权的领域对象，包含 `status`、`attemptCount`、`processingLeaseUntil` 字段。
   * @param token - 用于按租约标识和到期时间判定当前执行权的领域对象，包含 `attempt`、`leaseUntil` 字段。
   * @returns 满足按租约标识和到期时间判定当前执行权约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private owns(delivery: QqbotMessageDelivery, token: ClaimToken): boolean {
    return (
      delivery.status === 'processing' &&
      delivery.attemptCount === token.attempt &&
      delivery.processingLeaseUntil?.getTime() === token.leaseUntil.getTime()
    );
  }
}
