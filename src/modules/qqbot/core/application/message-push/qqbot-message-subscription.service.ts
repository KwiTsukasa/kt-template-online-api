import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { throwVbenError } from '@/common';
import {
  Like,
  In,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import {
  SystemMessageContractError,
  type MessageSubscriptionInput,
  type MessageSubscriptionListQuery,
  type MessageSubscriptionView,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotMessageSubscription } from '../../infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';

const DEFAULT_PAGE_NO = 1;
const DEFAULT_PAGE_SIZE = 10;

type NormalizedSubscriptionInput = {
  activeKey: string;
  enabled: boolean;
  name: string;
  remark: null | string;
  sourceConfig: Record<string, string>;
  sourceConfigDigest: string;
  sourceKey: string;
};

@Injectable()
export class QqbotMessageSubscriptionService {
  constructor(
    @InjectRepository(QqbotMessageSubscription)
    private readonly subscriptionRepository: Repository<QqbotMessageSubscription>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
  ) {}

  async page(query: MessageSubscriptionListQuery): Promise<{
    items: MessageSubscriptionView[];
    total: number;
  }> {
    const pageNo = Math.max(
      DEFAULT_PAGE_NO,
      Math.floor(query.pageNo ?? DEFAULT_PAGE_NO),
    );
    const pageSize = Math.max(
      1,
      Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where: FindOptionsWhere<QqbotMessageSubscription> = {
      isDeleted: false,
    };
    if (query.name) where.name = Like(`%${query.name}%`);
    if (query.sourceKey) where.sourceKey = query.sourceKey;
    if (query.enabled !== undefined) where.enabled = query.enabled;

    const [subscriptions, total] =
      await this.subscriptionRepository.findAndCount({
        order: { createTime: 'DESC', id: 'DESC' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        where,
      });
    return {
      items: await Promise.all(subscriptions.map((item) => this.toView(item))),
      total,
    };
  }

  async create(
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        async (manager) => {
          const repository = manager.getRepository(QqbotMessageSubscription);
          const active = await repository.findOne({
            where: { activeKey: normalized.activeKey, isDeleted: false },
          });
          if (active) this.throwNaturalKeyConflict();

          const historicalCandidate = await repository.findOne({
            order: { updateTime: 'DESC', id: 'DESC' },
            where: {
              isDeleted: true,
              sourceConfigDigest: normalized.sourceConfigDigest,
              sourceKey: normalized.sourceKey,
            },
          });
          if (historicalCandidate) {
            const historical = await repository.findOne({
              lock: { mode: 'pessimistic_write' },
              where: { id: historicalCandidate.id, isDeleted: true },
            });
            if (historical) {
              Object.assign(historical, normalized, { isDeleted: false });
              return repository.save(historical);
            }
          }
          return repository.save(
            repository.create({ ...normalized, isDeleted: false }),
          );
        },
      );
      return this.toView(saved);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  async update(
    id: string,
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        async (manager) => {
          const repository = manager.getRepository(QqbotMessageSubscription);
          const current = await this.findActiveForWrite(repository, id);
          if (current.sourceKey !== normalized.sourceKey) {
            await this.assertNoLiveBindings(manager, id);
          }
          const conflict = await repository.findOne({
            where: { activeKey: normalized.activeKey, isDeleted: false },
          });
          if (conflict && conflict.id !== current.id) {
            this.throwNaturalKeyConflict();
          }
          const sourceIdentityChanged =
            current.sourceKey !== normalized.sourceKey ||
            current.sourceConfigDigest !== normalized.sourceConfigDigest;
          Object.assign(current, normalized);
          const saved = await repository.save(current);
          if (!saved.enabled || sourceIdentityChanged) {
            await this.cancelUnfinishedDeliveries(
              manager,
              {
                subscriptionId: saved.id,
              },
              sourceIdentityChanged,
            );
          }
          return saved;
        },
      );
      return this.toView(saved);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<MessageSubscriptionView> {
    const saved = await this.subscriptionRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(QqbotMessageSubscription);
        const current = await this.findActiveForWrite(repository, id);
        if (enabled) {
          const inspection = await this.sourceRegistry
            .get(current.sourceKey)
            .inspectSubscription(current.sourceConfig);
          if (!inspection.valid) {
            throw new SystemMessageContractError(
              inspection.invalidReasonCode || 'invalid_source_config',
            );
          }
        }
        current.enabled = enabled;
        const saved = await repository.save(current);
        if (!saved.enabled) {
          await this.cancelUnfinishedDeliveries(manager, {
            subscriptionId: saved.id,
          });
        }
        return saved;
      },
    );
    return this.toView(saved);
  }

  async remove(id: string): Promise<boolean> {
    return this.subscriptionRepository.manager.transaction(
      // 保持活跃订阅行锁，直至删除安全字段一并持久化。
      async (manager) => {
        const repository = manager.getRepository(QqbotMessageSubscription);
        const current = await this.findActiveForWrite(repository, id);
        await this.assertNoLiveBindings(manager, id);
        current.activeKey = null;
        current.enabled = false;
        current.isDeleted = true;
        await repository.save(current);
        await this.cancelUnfinishedDeliveries(manager, {
          subscriptionId: current.id,
        });
        return true;
      },
    );
  }

  async requireAvailableForBinding(
    manager: EntityManager,
    subscriptionId: string,
    bindingEnabled: boolean,
  ): Promise<QqbotMessageSubscription> {
    const subscription = await manager
      .getRepository(QqbotMessageSubscription)
      .findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: subscriptionId, isDeleted: false },
      });
    if (!subscription) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    if (!bindingEnabled) return subscription;
    if (!subscription.enabled) {
      throw new SystemMessageContractError('subscription_disabled');
    }
    const inspection = await this.sourceRegistry
      .get(subscription.sourceKey)
      .inspectSubscription(subscription.sourceConfig);
    if (!inspection.valid) {
      throw new SystemMessageContractError(
        inspection.invalidReasonCode || 'invalid_source_config',
      );
    }
    return subscription;
  }

  private async normalizeInput(
    input: MessageSubscriptionInput,
  ): Promise<NormalizedSubscriptionInput> {
    const adapter = this.sourceRegistry.get(input.sourceKey);
    const normalized = await adapter.normalizeSubscriptionConfig(
      input.sourceConfig,
    );
    const sourceConfig = this.sortConfig(normalized.canonicalConfig);
    const sourceConfigDigest = createHash('sha256')
      .update(JSON.stringify(sourceConfig))
      .digest('hex');
    return {
      activeKey: `${input.sourceKey}:${sourceConfigDigest}`,
      enabled: input.enabled,
      name: input.name.trim(),
      remark: input.remark?.trim() || null,
      sourceConfig,
      sourceConfigDigest,
      sourceKey: input.sourceKey,
    };
  }

  private sortConfig(config: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(config).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  private async findActiveForWrite(
    repository: Repository<QqbotMessageSubscription>,
    id: string,
  ): Promise<QqbotMessageSubscription> {
    const current = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id, isDeleted: false },
    });
    if (!current) throw new SystemMessageContractError('invalid_source_config');
    return current;
  }

  private async assertNoLiveBindings(
    manager: EntityManager,
    subscriptionId: string,
  ): Promise<void> {
    const count = await manager
      .getRepository(QqbotMessagePublishBinding)
      .count({
        where: { isDeleted: false, subscriptionId },
      });
    if (count > 0) {
      throw new SystemMessageContractError('invalid_source_config');
    }
  }

  private async cancelUnfinishedDeliveries(
    manager: EntityManager,
    where: Pick<QqbotMessageDelivery, 'subscriptionId'>,
    includeProcessing = false,
  ): Promise<void> {
    await manager.getRepository(QqbotMessageDelivery).update(
      {
        ...where,
        status: In([
          'waiting_ddns',
          'pending',
          'retry',
          ...(includeProcessing ? (['processing'] as const) : []),
        ]),
      },
      {
        status: 'cancelled',
        nextAttemptAt: null,
        processingLeaseUntil: null,
      },
    );
  }

  private throwNaturalKeyConflict(): never {
    return throwVbenError('相同消息源配置的订阅已存在', HttpStatus.CONFLICT);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  private async toView(
    subscription: QqbotMessageSubscription,
  ): Promise<MessageSubscriptionView> {
    const adapter = this.sourceRegistry.get(subscription.sourceKey);
    const inspection = await adapter.inspectSubscription(
      subscription.sourceConfig,
    );
    return {
      createTime: this.serializeTime(subscription.createTime),
      enabled: subscription.enabled,
      id: String(subscription.id),
      invalidReasonCode: inspection.invalidReasonCode,
      name: subscription.name,
      remark: subscription.remark?.trim() || null,
      sourceConfig: structuredClone(
        subscription.sourceConfig,
      ) as unknown as MessageSubscriptionView['sourceConfig'],
      sourceKey: subscription.sourceKey,
      sourceName: adapter.definition.displayName,
      sourceSummary: inspection.sourceSummary,
      updateTime: this.serializeTime(subscription.updateTime),
      valid: inspection.valid,
    };
  }

  private serializeTime(value: QqbotMessageSubscription['createTime']): string {
    return String(value);
  }
}
