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
  type SystemMessageSourceDefinition,
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

  /**
   * 查询领域服务并组装管理端页面。
   * @param query - 限定QQBot 管理分页结果筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`name`、`sourceKey` 字段。
   * @returns 包含 `items`、`total` 字段的QQBot 管理分页；没有匹配项时为空数组。
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
   * 根据`input`构造QQBot消息订阅记录。
   * @param input - 用于QQBot消息订阅记录的结构化输入。
   * @returns QQBot消息订阅记录。
   * @throws 当 `subscriptionRepository.manager.transaction` 或 `toView` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
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

  /**
   * 根据`id`、`input`更新QQBot消息订阅记录。
   * @param id - 决定QQBot消息订阅记录内容、边界或目标的 `id` 值。
   * @param input - 用于QQBot消息订阅记录的结构化输入。
   * @returns QQBot消息订阅记录。
   * @throws 当 `subscriptionRepository.manager.transaction` 或 `toView` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
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

  /**
   * 在事务中切换消息订阅启用状态；启用前重新校验来源配置，并返回更新后的订阅视图。
   * @param id - 决定启用内容、边界或目标的 `id` 值。
   * @param enabled - 决定启用内容、边界或目标的 `enabled` 值。
   * @returns 启用。
   */
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

  /**
   * 按`id`移除QQBot消息订阅记录。
   * @param id - 决定QQBot消息订阅记录内容、边界或目标的 `id` 值。
   * @returns QQBot消息订阅记录。
   */
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

  /**
   * 加载指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用。
   * @param manager - 保证指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用读写处于同一事务中的实体管理器。
   * @param subscriptionId - 用于精确定位订阅的标识。
   * @param bindingEnabled - 决定指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用内容、边界或目标的 `bindingEnabled` 值。
   * @returns 返回已验证可绑定的订阅或模板记录。
   * @throws 当 `!subscription` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `!subscription.enabled` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `!inspection.valid` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
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
   * 按参数 `input`，校验来源配置后生成稳定摘要和持久化字段。
   * @param input - 用于按参数 `input`，校验来源配置后生成稳定摘要和持久化字段的结构化输入，包含 `sourceKey`、`sourceConfig`、`enabled`、`name` 字段。
   * @returns 包含 `activeKey`、`enabled`、`name`、`remark`、`sourceConfig` 字段的按参数 `input`，校验来源配置后生成稳定摘要和持久化字段。
   */
  private async normalizeInput(
    input: MessageSubscriptionInput,
  ): Promise<NormalizedSubscriptionInput> {
    const adapter = this.sourceRegistry.get(input.sourceKey);
    const validatedSourceConfig = this.validateSourceConfig(
      input.sourceConfig,
      adapter.definition,
    );
    const normalized = await adapter.normalizeSubscriptionConfig(
      validatedSourceConfig,
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
   * 按来源元数据精确接收自有字符串字段，并拒绝缺失或额外字段。
   * @param input - 用于来源配置的结构化输入。
   * @param definition - 用于来源配置的领域对象，包含 `subscriptionFields` 字段。
   * @returns 来源配置。
   * @throws 当 `!input || typeof input !== 'object' || Array.isArray(input)` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `!fields.has(key) || typeof value !== 'string'` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `field.required && !Object.prototype.hasOwnProperty.call(sourceConfig, f…` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  private validateSourceConfig(
    input: Record<string, unknown>,
    definition: SystemMessageSourceDefinition,
  ): Record<string, string> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    const fields = new Map(
      definition.subscriptionFields.map((field) => [field.key, field]),
    );
    const sourceConfig: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!fields.has(key) || typeof value !== 'string') {
        throw new SystemMessageContractError('invalid_source_config');
      }
      sourceConfig[key] = value;
    }
    for (const field of definition.subscriptionFields) {
      if (
        field.required &&
        !Object.prototype.hasOwnProperty.call(sourceConfig, field.key)
      ) {
        throw new SystemMessageContractError('invalid_source_config');
      }
    }
    return sourceConfig;
  }

  /**
   * 按字段名升序重建消息来源配置，使等价配置得到稳定的键顺序。
   * @param config - 限定配置边界、地址与开关的运行配置。
   * @returns 配置。
   */
  private sortConfig(config: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(config).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  /**
   * 按`repository`、`id`读取启用的用于写入；从 `repository.findOne` 读取启用的用于写入。
   * @param repository - 负责查询或持久化启用的用于写入的仓库实例。
   * @param id - 决定启用的用于写入内容、边界或目标的 `id` 值。
   * @returns 启用的用于写入。
   * @throws 当 `!current` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
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

  /**
   * 校验`manager`、`subscriptionId`是否满足无实时绑定约束，并拒绝不合法输入；从 `manager.getRepository` 读取无实时绑定。
   * @param manager - 保证无实时绑定读写处于同一事务中的实体管理器。
   * @param subscriptionId - 用于精确定位订阅的标识。
   * @throws 当 `count > 0` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
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
   * 根据`manager`、`where`、`includeProcessing`与当前约束判定未完成的投递记录；从 `manager.getRepository` 读取未完成的投递记录。
   * @param manager - 保证未完成的投递记录读写处于同一事务中的实体管理器。
   * @param where - 决定未完成的投递记录内容、边界或目标的 `where` 值。
   * @param includeProcessing - 决定是否启用“includeProcessing”分支的布尔选项；省略时默认采用 `false`。
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
          ...((() => {
            if (includeProcessing) {
              return (['processing'] as const);
            }
            return [];
          })()),
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
   * 把启用记录的自然键冲突统一映射为 HTTP 409 业务错误。
   * @returns 该函数不正常返回；调用会抛出 HTTP 409 自然键冲突错误。
   */
  private throwNaturalKeyConflict(): never {
    return throwVbenError('相同消息源配置的订阅已存在', HttpStatus.CONFLICT);
  }

  /**
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  /**
   * 将输入收敛并投影为视图。
   * @param subscription - 用于视图的领域对象，包含 `sourceKey`、`sourceConfig`、`createTime`、`enabled` 字段。
   * @returns 包含 `createTime`、`enabled`、`id`、`invalidReasonCode`、`name` 字段的视图。
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
   * 将`value`转换为序列化时间。
   * @param value - 待转换为序列化时间的原始值。
   * @returns 序列化时间。
   */
  private serializeTime(value: QqbotMessageSubscription['createTime']): string {
    return String(value);
  }
}
