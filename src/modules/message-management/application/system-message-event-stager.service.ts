import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { KtDateTime } from '@/common';
import {
  type SystemMessageEventInput,
  type SystemMessageEventStager,
} from '../contract/message-management.types';
import { MessageEvent } from '../infrastructure/persistence/message-event.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';

@Injectable()
export class SystemMessageEventStagerService implements SystemMessageEventStager {
  constructor(private readonly sourceRegistry: SystemMessageSourceRegistry) {}

  /**
   * 校验消息来源与事件载荷后，在当前事务中按事件标识幂等写入待扇出消息事件。
   * @param manager - 保证消息来源与事件载荷后，在当前事务中按事件标识幂等写入待扇出消息事件读写处于同一事务中的实体管理器。
   * @param input - 用于消息来源与事件载荷后，在当前事务中按事件标识幂等写入待扇出消息事件的结构化输入，包含 `sourceKey`、`payload`、`eventId`、`occurredAt` 字段。
   * @returns 当前状态对应的消息来源与事件载荷后，在当前事务中按事件标识幂等写入待扇出消息事件，取值为 `'duplicate'`、`'accepted'`。
   * @throws 当 `repository.save` 或 `repository.create` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async stage(
    manager: EntityManager,
    input: SystemMessageEventInput,
  ): Promise<'accepted' | 'duplicate'> {
    const payload = this.sourceRegistry
      .get(input.sourceKey)
      .validateEventPayload(input.payload);
    const repository = manager.getRepository(MessageEvent);
    if (await repository.findOne({ where: { eventId: input.eventId } })) {
      return 'duplicate';
    }
    try {
      await repository.save(
        repository.create({
          eventId: input.eventId,
          fanoutAttemptCount: 0,
          fanoutLeaseUntil: null,
          fanoutStatus: 'accepted',
          lastErrorCode: null,
          lastErrorMessage: null,
          nextFanoutAt: new KtDateTime(input.occurredAt),
          occurredAt: new KtDateTime(input.occurredAt),
          payload,
          resourceKey: input.resourceKey,
          sourceKey: input.sourceKey,
        }),
      );
      return 'accepted';
    } catch (error) {
      if (this.isDuplicateKeyError(error)) return 'duplicate';
      throw error;
    }
  }

  /**
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
