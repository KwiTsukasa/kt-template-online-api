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

/**
 * Manages source-normalized global system-message subscriptions and their binding lock gate.
 *
 * Database errors other than MySQL duplicate-key conflicts deliberately propagate so callers
 * cannot treat incomplete persistence as a valid subscription lifecycle transition.
 */
@Injectable()
export class QqbotMessageSubscriptionService {
  /**
   * Initializes subscription persistence and the live process-local source registry.
   * @param subscriptionRepository - Persistence root used to open lifecycle transactions.
   * @param sourceRegistry - Current registered source definitions and adapters.
   */
  constructor(
    @InjectRepository(QqbotMessageSubscription)
    private readonly subscriptionRepository: Repository<QqbotMessageSubscription>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
  ) {}

  /**
   * Pages non-deleted subscriptions with current source validity rather than stale snapshots.
   * @param query - Optional name, source key, enabled state, and pagination filters.
   * @returns Deterministically ordered detached subscription views and their total count.
   */
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

  /**
   * Creates a source-normalized subscription or revives its most recently updated history row.
   * @param input - Untrusted metadata and source configuration submitted by management UI.
   * @returns The new or revived subscription view.
   * @throws {HttpException} HTTP 409 when another active row owns the same natural key.
   */
  async create(
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        /** Lets the unique active key arbitrate new rows while locking only a selected history row. */
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

  /**
   * Replaces one active subscription's metadata and canonical source configuration.
   * @param id - String Snowflake identity of the subscription being changed.
   * @param input - Complete replacement metadata and untrusted source configuration.
   * @returns The updated view for the same subscription ID.
   * @throws {HttpException} HTTP 409 when another active subscription owns the new natural key.
   */
  async update(
    id: string,
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        /** Holds the target row through save; the unique index resolves prospective-key races. */
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

  /**
   * Changes an active subscription's enabled state after a live source validation when enabling.
   * @param id - String Snowflake identity of the active subscription.
   * @param enabled - Requested future enabled state.
   * @returns The updated detached subscription view.
   * @throws {SystemMessageContractError} With the current source reason when enabling is unsafe.
   */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<MessageSubscriptionView> {
    const saved = await this.subscriptionRepository.manager.transaction(
      /** Holds the subscription row while current source validity is checked and persisted. */
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

  /**
   * Soft-deletes one active subscription and releases its active natural key atomically.
   * @param id - String Snowflake identity of the subscription to remove.
   * @returns `true` once disabled/deleted state and null active key were persisted.
   */
  async remove(id: string): Promise<boolean> {
    return this.subscriptionRepository.manager.transaction(
      /** Holds the active row until its deletion-safe fields are stored together. */
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

  /**
   * Enforces the subscription half of the binding lock order before any live binding save.
   *
   * Callers must pass their current binding-write transaction manager, invoke this before
   * saving every new, updated, or revived non-deleted binding, and keep that transaction open
   * through the binding save and commit. Disabled bindings require this same lock because they
   * still reference the subscription and must not race a concurrent removal.
   * @param manager - Current binding transaction manager; never substitute a global manager.
   * @param subscriptionId - Candidate subscription's string Snowflake identity.
   * @param bindingEnabled - Whether the binding will be enabled for message delivery.
   * @returns The locked active subscription available to the requested binding state.
   * @throws {SystemMessageContractError} For deleted/missing subscriptions, disabled enabled-bindings, or invalid sources.
   */
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

  /**
   * Normalizes user input through the exact source adapter before any transaction begins.
   * @param input - Untrusted management payload with a requested source key.
   * @returns Detached canonical persistence fields and their stable SHA-256 natural key.
   */
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

  /**
   * Sorts a canonical configuration into a detached ordinary object for stable JSON hashing.
   * @param config - Adapter-owned allowlisted scalar configuration.
   * @returns New key-sorted object that cannot mutate the adapter-owned input object.
   */
  private sortConfig(config: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(config).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  /**
   * Locks and loads one active subscription for a direct lifecycle mutation.
   * @param repository - Repository obtained from the caller's current transaction manager.
   * @param id - String Snowflake identity of the expected active subscription.
   * @returns Locked active subscription row.
   * @throws {SystemMessageContractError} When the row is absent or already soft-deleted.
   */
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

  /** Rejects a dependency lifecycle mutation while any enabled or disabled live binding references it. */
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

  /**
   * Cancels historical deliveries in the caller's configuration transaction.
   * @param manager - Transaction manager that already owns the subscription mutation.
   * @param where - Exact subscription identity whose historical rows are invalidated.
   * @param includeProcessing - Whether a canonical identity change must revoke active owners too.
   */
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

  /**
   * Maps duplicate natural keys to the existing Vben-compatible HTTP conflict response.
   * @returns Never returns because it always throws an HTTP 409 exception.
   */
  private throwNaturalKeyConflict(): never {
    return throwVbenError('相同消息源配置的订阅已存在', HttpStatus.CONFLICT);
  }

  /**
   * Recognizes only MySQL duplicate-key failures that are the database's concurrency authority.
   * @param error - Unknown exception returned by transaction, repository, or driver layers.
   * @returns Whether the error represents MySQL `ER_DUP_ENTRY` / errno 1062.
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  /**
   * Maps a persistence row to a detached view using its current source definition and validity.
   * @param subscription - Persisted subscription row whose source configuration must not leak mutability.
   * @returns Serializable management view with live source summary and validity fields.
   */
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

  /**
   * Serializes project datetime values without silently converting them to UTC ISO text.
   * @param value - Entity date value transformed by the project's KtDateTime column type.
   * @returns Project-formatted datetime text used by the management contract.
   */
  private serializeTime(value: QqbotMessageSubscription['createTime']): string {
    return String(value);
  }
}
