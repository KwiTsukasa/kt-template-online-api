import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { throwVbenError } from '@/common';
import { In, Repository, type EntityManager } from 'typeorm';
import {
  SystemMessageContractError,
  type QqbotMessagePublishBindingInput,
  type QqbotMessagePublishBindingView,
  type QqbotMessagePublishTargetInput,
  type QqbotMessagePublishTargetView,
  type QqbotMessagePushTargetType,
} from '../../contract/message-push/qqbot-message-push.types';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageDelivery } from '../../infrastructure/persistence/message-push/qqbot-message-delivery.entity';
import { QqbotMessageSubscription } from '../../infrastructure/persistence/message-push/qqbot-message-subscription.entity';
import { QqbotMessageTemplate } from '../../infrastructure/persistence/message-push/qqbot-message-template.entity';
import { QqbotMessageSubscriptionService } from './qqbot-message-subscription.service';
import { QqbotMessageTemplateService } from './qqbot-message-template.service';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const TARGET_ID_PATTERN = /^[1-9]\d{4,19}$/;

type NormalizedTarget = {
  targetId: string;
  targetName: null | string;
  targetType: QqbotMessagePushTargetType;
};

/** Manages one QQBot account's publish bindings and their atomic target snapshots. */
@Injectable()
export class QqbotAccountMessagePushService {
  /** Initializes account-scoped binding persistence and the shared dependency gates. */
  constructor(
    @InjectRepository(QqbotMessagePublishBinding)
    private readonly bindingRepository: Repository<QqbotMessagePublishBinding>,
    @InjectRepository(QqbotMessagePublishTarget)
    private readonly targetRepository: Repository<QqbotMessagePublishTarget>,
    @InjectRepository(QqbotMessageSubscription)
    private readonly subscriptionRepository: Repository<QqbotMessageSubscription>,
    @InjectRepository(QqbotMessageTemplate)
    private readonly templateRepository: Repository<QqbotMessageTemplate>,
    private readonly accountService: QqbotAccountService,
    private readonly subscriptionService: QqbotMessageSubscriptionService,
    private readonly templateService: QqbotMessageTemplateService,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly renderer: SystemMessageTemplateRendererService,
  ) {}

  /** Lists active bindings belonging only to the requested account in deterministic order. */
  async listBindings(
    selfId: string,
  ): Promise<QqbotMessagePublishBindingView[]> {
    const account = await this.requireAccount(selfId);
    const bindings = await this.bindingRepository.find({
      order: { createTime: 'ASC', id: 'ASC' },
      where: { accountId: String(account.id), isDeleted: false },
    });
    return Promise.all(bindings.map((binding) => this.toView(binding)));
  }

  /** Creates or revives the account/subscription binding and replaces its targets atomically. */
  async createBinding(
    selfId: string,
    input: QqbotMessagePublishBindingInput,
  ): Promise<QqbotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const normalizedTargets = this.normalizeTargets(input.targets);
    try {
      const binding = await this.bindingRepository.manager.transaction(
        async (manager) => {
          const bindings = manager.getRepository(QqbotMessagePublishBinding);
          const activeKey = this.bindingActiveKey(
            account.id,
            input.subscriptionId,
          );
          const active = await bindings.findOne({
            where: { activeKey, isDeleted: false },
          });
          if (active) this.throwNaturalKeyConflict();
          const historicalCandidate = await bindings.findOne({
            order: { updateTime: 'DESC', id: 'DESC' },
            where: {
              accountId: String(account.id),
              isDeleted: true,
              subscriptionId: input.subscriptionId,
            },
          });
          const subscription =
            await this.subscriptionService.requireAvailableForBinding(
              manager,
              input.subscriptionId,
              input.enabled,
            );
          await this.templateService.requireAvailableForBinding(
            manager,
            input.templateId,
            subscription.sourceKey,
            input.enabled,
          );
          let binding: QqbotMessagePublishBinding;
          if (historicalCandidate) {
            const historical = await bindings.findOne({
              lock: { mode: 'pessimistic_write' },
              where: {
                accountId: String(account.id),
                id: historicalCandidate.id,
                isDeleted: true,
                selfId: String(account.selfId),
                subscriptionId: String(input.subscriptionId),
              },
            });
            if (historical) {
              Object.assign(
                historical,
                this.toBindingFields(account, input, activeKey),
                {
                  isDeleted: false,
                },
              );
              binding = await bindings.save(historical);
            } else {
              binding = await bindings.save(
                bindings.create({
                  ...this.toBindingFields(account, input, activeKey),
                  isDeleted: false,
                }),
              );
            }
          } else {
            binding = await bindings.save(
              bindings.create({
                ...this.toBindingFields(account, input, activeKey),
                isDeleted: false,
              }),
            );
          }
          await this.synchronizeTargets(manager, binding, normalizedTargets);
          return binding;
        },
      );
      return this.toView(binding);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /** Replaces an account-scoped binding's dependencies, enabled switch, and targets atomically. */
  async updateBinding(
    selfId: string,
    id: string,
    input: QqbotMessagePublishBindingInput,
  ): Promise<QqbotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const normalizedTargets = this.normalizeTargets(input.targets);
    try {
      const binding = await this.bindingRepository.manager.transaction(
        async (manager) => {
          const bindings = manager.getRepository(QqbotMessagePublishBinding);
          const snapshot = await bindings.findOne({
            where: { accountId: String(account.id), id, isDeleted: false },
          });
          if (!snapshot) this.throwBindingUnavailable();
          const subscription =
            await this.subscriptionService.requireAvailableForBinding(
              manager,
              input.subscriptionId,
              input.enabled,
            );
          await this.templateService.requireAvailableForBinding(
            manager,
            input.templateId,
            subscription.sourceKey,
            input.enabled,
          );
          const current = await this.findBindingForWrite(
            bindings,
            account.id,
            id,
          );
          this.assertStableBindingSnapshot(current, snapshot!);
          const activeKey = this.bindingActiveKey(
            account.id,
            input.subscriptionId,
          );
          const conflict = await bindings.findOne({
            where: { activeKey, isDeleted: false },
          });
          if (conflict && String(conflict.id) !== String(current.id)) {
            this.throwNaturalKeyConflict();
          }
          Object.assign(
            current,
            this.toBindingFields(account, input, activeKey),
          );
          const saved = await bindings.save(current);
          await this.synchronizeTargets(manager, saved, normalizedTargets);
          if (
            !saved.enabled ||
            snapshot!.subscriptionId !== saved.subscriptionId
          ) {
            await this.cancelUnfinishedDeliveries(manager, {
              bindingId: saved.id,
            });
          }
          return saved;
        },
      );
      return this.toView(binding);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /** Changes a binding's user switch while applying both dependency gates in lock order. */
  async setBindingEnabled(
    selfId: string,
    id: string,
    enabled: boolean,
  ): Promise<QqbotMessagePublishBindingView> {
    const account = await this.requireAccount(selfId);
    const binding = await this.bindingRepository.manager.transaction(
      async (manager) => {
        const bindings = manager.getRepository(QqbotMessagePublishBinding);
        const snapshot = await bindings.findOne({
          where: { accountId: String(account.id), id, isDeleted: false },
        });
        if (!snapshot) this.throwBindingUnavailable();
        const subscription =
          await this.subscriptionService.requireAvailableForBinding(
            manager,
            snapshot!.subscriptionId,
            enabled,
          );
        await this.templateService.requireAvailableForBinding(
          manager,
          snapshot!.templateId,
          subscription.sourceKey,
          enabled,
        );
        const current = await this.findBindingForWrite(
          bindings,
          account.id,
          id,
        );
        this.assertStableBindingSnapshot(current, snapshot!);
        current.enabled = enabled;
        const saved = await bindings.save(current);
        if (!saved.enabled) {
          await this.cancelUnfinishedDeliveries(manager, {
            bindingId: saved.id,
          });
        }
        return saved;
      },
    );
    return this.toView(binding);
  }

  /** Soft-deletes one account-scoped binding and every active target in the same transaction. */
  async removeBinding(selfId: string, id: string): Promise<boolean> {
    const account = await this.requireAccount(selfId);
    await this.bindingRepository.manager.transaction(async (manager) => {
      const bindings = manager.getRepository(QqbotMessagePublishBinding);
      const targets = manager.getRepository(QqbotMessagePublishTarget);
      const binding = await this.findBindingForWrite(bindings, account.id, id);
      const activeTargets = await targets.find({
        lock: { mode: 'pessimistic_write' },
        where: { bindingId: String(binding.id), isDeleted: false },
      });
      activeTargets.forEach((target) => {
        target.activeKey = null;
        target.enabled = false;
        target.isDeleted = true;
      });
      if (activeTargets.length > 0) await targets.save(activeTargets);
      binding.activeKey = null;
      binding.enabled = false;
      binding.isDeleted = true;
      await bindings.save(binding);
      await this.cancelUnfinishedDeliveries(manager, { bindingId: binding.id });
    });
    return true;
  }

  /** Validates, trims, and deduplicates targets without converting IDs to numbers. */
  private normalizeTargets(
    inputs: QqbotMessagePublishTargetInput[],
  ): NormalizedTarget[] {
    const targets = new Map<string, NormalizedTarget>();
    inputs.forEach((input) => {
      const targetId = String(input.targetId ?? '').trim();
      if (!TARGET_ID_PATTERN.test(targetId)) {
        throw new SystemMessageContractError('invalid_target_id');
      }
      if (input.targetType !== 'group' && input.targetType !== 'private') {
        throw new SystemMessageContractError('invalid_target_type');
      }
      const target: NormalizedTarget = {
        targetId,
        targetName: input.targetName?.trim() || null,
        targetType: input.targetType,
      };
      targets.set(`${target.targetType}:${target.targetId}`, target);
    });
    return [...targets.values()].sort((left, right) =>
      this.targetActiveKey('0', left).localeCompare(
        this.targetActiveKey('0', right),
      ),
    );
  }

  /** Retains, revives, creates, and soft-deletes targets while holding the binding lock. */
  private async synchronizeTargets(
    manager: EntityManager,
    binding: QqbotMessagePublishBinding,
    selected: NormalizedTarget[],
  ): Promise<void> {
    const targets = manager.getRepository(QqbotMessagePublishTarget);
    const existing = await targets.find({
      lock: { mode: 'pessimistic_write' },
      order: { createTime: 'ASC', id: 'ASC' },
      where: { bindingId: String(binding.id) },
    });
    const selectedByKey = new Map(
      selected.map((target) => [
        this.targetActiveKey(binding.id, target),
        target,
      ]),
    );
    const historicalByKey = new Map(
      existing
        .filter((target) => target.isDeleted)
        .map((target) => [this.targetActiveKey(binding.id, target), target]),
    );
    const activeByKey = new Map(
      existing
        .filter((target) => !target.isDeleted)
        .map((target) => [this.targetActiveKey(binding.id, target), target]),
    );
    const saves: QqbotMessagePublishTarget[] = [];
    selectedByKey.forEach((target, activeKey) => {
      const current =
        activeByKey.get(activeKey) ?? historicalByKey.get(activeKey);
      if (current) {
        Object.assign(current, {
          activeKey,
          enabled: true,
          isDeleted: false,
          targetName: target.targetName,
        });
        saves.push(current);
      } else {
        saves.push(
          targets.create({
            activeKey,
            bindingId: String(binding.id),
            enabled: true,
            isDeleted: false,
            targetId: target.targetId,
            targetName: target.targetName,
            targetType: target.targetType,
          }),
        );
      }
    });
    activeByKey.forEach((target, activeKey) => {
      if (selectedByKey.has(activeKey)) return;
      Object.assign(target, {
        activeKey: null,
        enabled: false,
        isDeleted: true,
      });
      saves.push(target);
    });
    if (saves.length > 0) await targets.save(saves);
    const removedIds = saves
      .filter((target) => target.isDeleted)
      .map((target) => target.id);
    if (removedIds.length > 0) {
      await manager.getRepository(QqbotMessageDelivery).update(
        {
          publishTargetId: In(removedIds),
          status: In(['waiting_ddns', 'pending', 'retry']),
        },
        {
          nextAttemptAt: null,
          processingLeaseUntil: null,
          status: 'cancelled',
        },
      );
    }
  }

  /** Builds a detached binding view using live dependency availability and active targets only. */
  private async toView(
    binding: QqbotMessagePublishBinding,
  ): Promise<QqbotMessagePublishBindingView> {
    const [subscription, template, targets] = await Promise.all([
      this.subscriptionRepository.findOne({
        where: { id: binding.subscriptionId, isDeleted: false },
      }),
      this.templateRepository.findOne({
        where: { id: binding.templateId, isDeleted: false },
      }),
      this.targetRepository.find({
        order: { createTime: 'ASC', id: 'ASC' },
        where: { bindingId: String(binding.id), isDeleted: false },
      }),
    ]);
    const state = await this.inspectAvailability(subscription, template);
    return {
      available: state.available,
      createTime: String(binding.createTime),
      enabled: binding.enabled,
      id: String(binding.id),
      invalidReasonCode: state.invalidReasonCode,
      sourceKey: subscription?.sourceKey ?? '',
      sourceName: state.sourceName,
      subscriptionId: String(binding.subscriptionId),
      subscriptionName: subscription?.name ?? '',
      targets: targets.map((target) => this.toTargetView(target)),
      templateId: String(binding.templateId),
      templateName: template?.name ?? '',
      updateTime: String(binding.updateTime),
    };
  }

  /** Computes live binding eligibility without changing its independent user enabled switch. */
  private async inspectAvailability(
    subscription: QqbotMessageSubscription | null,
    template: QqbotMessageTemplate | null,
  ): Promise<{
    available: boolean;
    invalidReasonCode: null | string;
    sourceName: string;
  }> {
    if (!subscription || subscription.isDeleted) {
      return {
        available: false,
        invalidReasonCode: 'invalid_source_config',
        sourceName: '',
      };
    }
    let sourceName = subscription.sourceKey;
    try {
      const adapter = this.sourceRegistry.get(subscription.sourceKey);
      sourceName = adapter.definition.displayName;
      const inspection = await adapter.inspectSubscription(
        subscription.sourceConfig,
      );
      if (!inspection.valid) {
        return {
          available: false,
          invalidReasonCode:
            inspection.invalidReasonCode || 'invalid_source_config',
          sourceName,
        };
      }
    } catch {
      return {
        available: false,
        invalidReasonCode: 'invalid_source_config',
        sourceName,
      };
    }
    if (!subscription.enabled) {
      return {
        available: false,
        invalidReasonCode: 'subscription_disabled',
        sourceName,
      };
    }
    if (
      !template ||
      template.isDeleted ||
      template.sourceKey !== subscription.sourceKey ||
      !template.enabled
    ) {
      return {
        available: false,
        invalidReasonCode: 'template_invalid',
        sourceName,
      };
    }
    try {
      const definition = this.sourceRegistry.get(
        subscription.sourceKey,
      ).definition;
      this.renderer.validate(
        template.content,
        definition.variables.map((variable) => variable.key),
      );
    } catch {
      return {
        available: false,
        invalidReasonCode: 'template_invalid',
        sourceName,
      };
    }
    return { available: true, invalidReasonCode: null, sourceName };
  }

  /** Maps one persisted target to the detached active-target response contract. */
  private toTargetView(
    target: QqbotMessagePublishTarget,
  ): QqbotMessagePublishTargetView {
    return {
      enabled: target.enabled,
      id: String(target.id),
      targetId: String(target.targetId),
      targetName: target.targetName?.trim() || null,
      targetType: target.targetType,
    };
  }

  /** Loads the configured non-deleted account and preserves its string identity. */
  private async requireAccount(selfId: string) {
    const account = await this.accountService.findBySelfId(selfId);
    if (!account) throw new SystemMessageContractError('account_unavailable');
    return account;
  }

  /** Locks one active binding for the resolved account without allowing cross-account access. */
  private async findBindingForWrite(
    repository: Repository<QqbotMessagePublishBinding>,
    accountId: string,
    id: string,
  ): Promise<QqbotMessagePublishBinding> {
    const binding = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { accountId: String(accountId), id, isDeleted: false },
    });
    if (!binding) this.throwBindingUnavailable();
    return binding!;
  }

  /** Refuses stale snapshots before a binding write can use changed account ownership. */
  private assertStableAccountSnapshot(
    binding: QqbotMessagePublishBinding,
    snapshot: QqbotMessagePublishBinding,
  ): void {
    if (
      binding.accountId !== snapshot.accountId ||
      binding.selfId !== snapshot.selfId
    ) {
      this.throwBindingUnavailable();
    }
  }

  /** Refuses stale snapshots when a toggle's dependency identities changed before its write lock. */
  private assertStableBindingSnapshot(
    binding: QqbotMessagePublishBinding,
    snapshot: QqbotMessagePublishBinding,
  ): void {
    this.assertStableAccountSnapshot(binding, snapshot);
    if (
      binding.subscriptionId !== snapshot.subscriptionId ||
      binding.templateId !== snapshot.templateId
    ) {
      this.throwBindingUnavailable();
    }
  }

  /** Builds the active natural key for a single account and subscription. */
  private bindingActiveKey(accountId: string, subscriptionId: string): string {
    return `${String(accountId)}:${String(subscriptionId)}`;
  }

  /** Builds the active natural key for a single binding target without number coercion. */
  private targetActiveKey(
    bindingId: string,
    target: Pick<NormalizedTarget, 'targetId' | 'targetType'>,
  ): string {
    return `${String(bindingId)}:${target.targetType}:${target.targetId}`;
  }

  /** Converts complete UI input into the binding fields owned by this service. */
  private toBindingFields(
    account: { id: string; selfId: string },
    input: QqbotMessagePublishBindingInput,
    activeKey: string,
  ): Pick<
    QqbotMessagePublishBinding,
    | 'accountId'
    | 'activeKey'
    | 'enabled'
    | 'selfId'
    | 'subscriptionId'
    | 'templateId'
  > {
    return {
      accountId: String(account.id),
      activeKey,
      enabled: input.enabled,
      selfId: String(account.selfId),
      subscriptionId: String(input.subscriptionId),
      templateId: String(input.templateId),
    };
  }

  /** Maps duplicate active binding or target natural keys to the management HTTP conflict. */
  private throwNaturalKeyConflict(): never {
    return throwVbenError(
      '同一账号订阅的消息发布配置已存在',
      HttpStatus.CONFLICT,
    );
  }

  /** Signals that a target binding is missing, deleted, or owned by another account. */
  private throwBindingUnavailable(): never {
    throw new SystemMessageContractError('binding_disabled');
  }

  /** Recognizes only MySQL's duplicate-key conflict used as final concurrency authority. */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  /** Cancels only not-yet-processing deliveries in the active binding mutation transaction. */
  private async cancelUnfinishedDeliveries(
    manager: EntityManager,
    where: Pick<QqbotMessageDelivery, 'bindingId'>,
  ): Promise<void> {
    await manager.getRepository(QqbotMessageDelivery).update(
      { ...where, status: In(['waiting_ddns', 'pending', 'retry']) },
      {
        nextAttemptAt: null,
        processingLeaseUntil: null,
        status: 'cancelled',
      },
    );
  }
}
