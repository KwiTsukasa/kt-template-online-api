import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { throwVbenError } from '@/common';
import {
  In,
  Like,
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
} from '../contract/message-management.types';
import { MessageSubscription } from '../infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../infrastructure/persistence/message-template.entity';
import { MessageSubscriberRegistry } from './subscriber/message-subscriber.registry';
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
  subscriberKey: string;
  templateBindingDigest: string;
  templateIds: string[];
};

export interface AvailableMessageSubscription {
  subscription: MessageSubscription;
  templates: MessageTemplate[];
}

@Injectable()
export class MessageSubscriptionService {
  constructor(
    @InjectRepository(MessageSubscription)
    private readonly subscriptionRepository: Repository<MessageSubscription>,
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly subscriberRegistry: MessageSubscriberRegistry,
  ) {}

  /**
   * 按模板来源、订阅者和通用分页条件查询消息订阅，并补齐模板与订阅者视图。
   * @param query - 消息订阅的名称、来源、模板、订阅者、启用状态和分页条件。
   * @returns 匹配订阅的分页记录和总数。
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
    const where: FindOptionsWhere<MessageSubscription> = {
      isDeleted: false,
    };
    if (query.name) where.name = Like(`%${query.name}%`);
    if (query.enabled !== undefined) where.enabled = query.enabled;
    if (query.subscriberKey) where.subscriberKey = query.subscriberKey;

    if (query.sourceKey || query.templateId) {
      const templateWhere: FindOptionsWhere<MessageTemplate> = {
        isDeleted: false,
      };
      if (query.sourceKey) templateWhere.sourceKey = query.sourceKey;
      if (query.templateId) templateWhere.id = query.templateId;
      const templates = await this.templateRepository.find({
        select: { id: true },
        where: templateWhere,
      });
      if (templates.length === 0) return { items: [], total: 0 };
      const bindings = await this.subscriptionRepository.manager
        .getRepository(MessageSubscriptionTemplate)
        .find({
          select: { subscriptionId: true },
          where: { templateId: In(templates.map((template) => template.id)) },
        });
      if (bindings.length === 0) return { items: [], total: 0 };
      where.id = In([
        ...new Set(bindings.map((binding) => binding.subscriptionId)),
      ]);
    }

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
   * 创建直接绑定消息模板与订阅者的消息订阅，并复用同自然键的历史软删除记录。
   * @param input - 模板、订阅者、来源筛选配置和管理字段。
   * @returns 新建或恢复后的消息订阅视图。
   * @throws 自然键重复或模板、订阅者、来源配置不合法时抛出契约错误。
   */
  async create(
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    const { templateIds, ...subscriptionFields } = normalized;
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        async (manager) => {
          const repository = manager.getRepository(MessageSubscription);
          const active = await repository.findOne({
            where: { activeKey: normalized.activeKey, isDeleted: false },
          });
          if (active) this.throwNaturalKeyConflict();

          const historicalCandidate = await repository.findOne({
            order: { updateTime: 'DESC', id: 'DESC' },
            where: {
              isDeleted: true,
              sourceConfigDigest: normalized.sourceConfigDigest,
              subscriberKey: normalized.subscriberKey,
              templateBindingDigest: normalized.templateBindingDigest,
            },
          });
          let persisted: MessageSubscription;
          if (historicalCandidate) {
            const historical = await repository.findOne({
              lock: { mode: 'pessimistic_write' },
              where: { id: historicalCandidate.id, isDeleted: true },
            });
            if (historical) {
              Object.assign(historical, subscriptionFields, {
                isDeleted: false,
              });
              persisted = await repository.save(historical);
              await this.synchronizeTemplateBindings(
                manager,
                persisted.id,
                templateIds,
              );
              return persisted;
            }
          }
          persisted = await repository.save(
            repository.create({ ...subscriptionFields, isDeleted: false }),
          );
          await this.synchronizeTemplateBindings(
            manager,
            persisted.id,
            templateIds,
          );
          return persisted;
        },
      );
      return this.toView(saved);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /**
   * 更新订阅绑定的模板、订阅者与来源筛选配置，并取消旧身份下尚未完成的投递。
   * @param id - 待更新的消息订阅标识。
   * @param input - 新的模板、订阅者、来源筛选配置和管理字段。
   * @returns 更新后的消息订阅视图。
   * @throws 订阅不存在、订阅者切换仍有私有绑定或自然键冲突时抛出契约错误。
   */
  async update(
    id: string,
    input: MessageSubscriptionInput,
  ): Promise<MessageSubscriptionView> {
    const normalized = await this.normalizeInput(input);
    const { templateIds, ...subscriptionFields } = normalized;
    try {
      const saved = await this.subscriptionRepository.manager.transaction(
        async (manager) => {
          const repository = manager.getRepository(MessageSubscription);
          const current = await this.findActiveForWrite(repository, id);
          const previousSubscriberKey = current.subscriberKey;
          if (previousSubscriberKey !== normalized.subscriberKey) {
            await this.assertNoLiveBindings(
              manager,
              current.id,
              previousSubscriberKey,
            );
          }
          const conflict = await repository.findOne({
            where: { activeKey: normalized.activeKey, isDeleted: false },
          });
          if (conflict && conflict.id !== current.id) {
            this.throwNaturalKeyConflict();
          }
          const deliveryIdentityChanged =
            current.templateBindingDigest !==
              normalized.templateBindingDigest ||
            current.subscriberKey !== normalized.subscriberKey ||
            current.sourceConfigDigest !== normalized.sourceConfigDigest;
          Object.assign(current, subscriptionFields);
          const persisted = await repository.save(current);
          await this.synchronizeTemplateBindings(
            manager,
            persisted.id,
            templateIds,
          );
          if (!persisted.enabled || deliveryIdentityChanged) {
            await this.cancelUnfinishedDeliveries(
              manager,
              previousSubscriberKey,
              persisted.id,
              deliveryIdentityChanged,
            );
          }
          return persisted;
        },
      );
      return this.toView(saved);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) this.throwNaturalKeyConflict();
      throw error;
    }
  }

  /**
   * 切换消息订阅启用状态，启用前重新验证模板、订阅者及来源配置。
   * @param id - 待切换状态的消息订阅标识。
   * @param enabled - 是否允许后续消息进入该订阅者。
   * @returns 状态切换后的消息订阅视图。
   */
  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<MessageSubscriptionView> {
    const saved = await this.subscriptionRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(MessageSubscription);
        const current = await this.findActiveForWrite(repository, id);
        if (enabled) {
          await this.requireAvailableForBinding(
            manager,
            current.id,
            current.subscriberKey,
            true,
          );
        }
        current.enabled = enabled;
        const persisted = await repository.save(current);
        if (!persisted.enabled) {
          await this.cancelUnfinishedDeliveries(
            manager,
            persisted.subscriberKey,
            persisted.id,
          );
        }
        return persisted;
      },
    );
    return this.toView(saved);
  }

  /**
   * 在没有订阅者私有配置引用时软删除消息订阅，并取消对应订阅者的未完成投递。
   * @param id - 待删除的消息订阅标识。
   * @returns 删除成功时返回 true。
   */
  async remove(id: string): Promise<boolean> {
    return this.subscriptionRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(MessageSubscription);
      const current = await this.findActiveForWrite(repository, id);
      await this.assertNoLiveBindings(
        manager,
        current.id,
        current.subscriberKey,
      );
      current.activeKey = null;
      current.enabled = false;
      current.isDeleted = true;
      await repository.save(current);
      await this.cancelUnfinishedDeliveries(
        manager,
        current.subscriberKey,
        current.id,
      );
      return true;
    });
  }

  /**
   * 校验订阅确实归属指定订阅者，并从其绑定模板派生消息源契约。
   * @param manager - 与订阅者私有配置写入共享事务的实体管理器。
   * @param subscriptionId - 订阅者私有配置引用的消息订阅标识。
   * @param subscriberKey - 当前订阅者适配器的稳定协议键。
   * @param bindingEnabled - 是否要求订阅、模板和来源配置当前全部可用。
   * @returns 已验证的订阅及其全部有序绑定模板。
   * @throws 订阅者不匹配、模板不可用或来源配置失效时抛出契约错误。
   */
  async requireAvailableForBinding(
    manager: EntityManager,
    subscriptionId: string,
    subscriberKey: string,
    bindingEnabled: boolean,
  ): Promise<AvailableMessageSubscription> {
    const subscription = await manager
      .getRepository(MessageSubscription)
      .findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: subscriptionId, isDeleted: false },
      });
    if (!subscription) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    if (subscription.subscriberKey !== subscriberKey) {
      throw new SystemMessageContractError('subscriber_mismatch');
    }
    this.subscriberRegistry.require(subscription.subscriberKey);
    const templates = await this.loadSubscriptionTemplates(
      manager,
      subscription.id,
    );
    if (bindingEnabled) {
      if (!subscription.enabled) {
        throw new SystemMessageContractError('subscription_disabled');
      }
      if (templates.some((template) => !template.enabled)) {
        throw new SystemMessageContractError('template_invalid');
      }
      const inspection = await this.sourceRegistry
        .get(templates[0].sourceKey)
        .inspectSubscription(subscription.sourceConfig);
      if (!inspection.valid) {
        throw new SystemMessageContractError(
          inspection.invalidReasonCode || 'invalid_source_config',
        );
      }
    }
    return { subscription, templates };
  }

  /**
   * 从订阅绑定模板解析消息源，再规范化来源配置与订阅自然键。
   * @param input - 模板、订阅者、来源筛选配置和管理字段。
   * @returns 可直接持久化的规范化订阅字段。
   * @throws 模板集合为空、重复、禁用或跨来源，订阅者未注册，或来源配置不合法时抛出契约错误。
   */
  private async normalizeInput(
    input: MessageSubscriptionInput,
  ): Promise<NormalizedSubscriptionInput> {
    const templateIds = input.templateIds.map((templateId) =>
      String(templateId),
    );
    if (
      templateIds.length === 0 ||
      new Set(templateIds).size !== templateIds.length
    ) {
      throw new SystemMessageContractError('template_invalid');
    }
    const subscriberKey = input.subscriberKey.trim();
    const templates = await this.loadTemplatesByIds(
      this.templateRepository.manager,
      templateIds,
    );
    if (input.enabled && templates.some((template) => !template.enabled)) {
      throw new SystemMessageContractError('template_invalid');
    }
    this.subscriberRegistry.require(subscriberKey);
    const adapter = this.sourceRegistry.get(templates[0].sourceKey);
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
    const templateBindingDigest = createHash('sha256')
      .update(JSON.stringify(templateIds))
      .digest('hex');
    return {
      activeKey: `${subscriberKey}:${templateBindingDigest}:${sourceConfigDigest}`,
      enabled: input.enabled,
      name: input.name.trim(),
      remark: this.normalizeRemark(input.remark),
      sourceConfig,
      sourceConfigDigest,
      subscriberKey,
      templateBindingDigest,
      templateIds,
    };
  }

  /**
   * 按输入顺序加载一组模板，并强制它们全部存在、未删除且属于同一消息源。
   * @param manager - 读取消息模板的实体管理器。
   * @param templateIds - 不允许重复的有序消息模板标识。
   * @returns 与输入顺序一致的同源消息模板数组。
   * @throws 任一模板不存在、已删除或来源不一致时抛出契约错误。
   */
  private async loadTemplatesByIds(
    manager: EntityManager,
    templateIds: string[],
  ): Promise<MessageTemplate[]> {
    const templates = await manager.getRepository(MessageTemplate).find({
      where: { id: In(templateIds), isDeleted: false },
    });
    const byId = new Map(
      templates.map((template) => [String(template.id), template]),
    );
    const ordered: MessageTemplate[] = [];
    for (const templateId of templateIds) {
      const template = byId.get(templateId);
      if (!template) {
        throw new SystemMessageContractError('template_invalid');
      }
      ordered.push(template);
    }
    const sourceKey = ordered[0].sourceKey;
    if (ordered.some((template) => template.sourceKey !== sourceKey)) {
      throw new SystemMessageContractError('template_source_mismatch');
    }
    return ordered;
  }

  /**
   * 按订阅模板关联的排序字段加载全部模板，并拒绝空关联或损坏关联。
   * @param manager - 读取订阅模板关联与模板记录的实体管理器。
   * @param subscriptionId - 需要解析模板集合的消息订阅标识。
   * @returns 订阅绑定的全部有序同源模板。
   * @throws 订阅没有模板或关联指向不可用模板时抛出契约错误。
   */
  private async loadSubscriptionTemplates(
    manager: EntityManager,
    subscriptionId: string,
  ): Promise<MessageTemplate[]> {
    const bindings = await manager
      .getRepository(MessageSubscriptionTemplate)
      .find({
        order: { sortOrder: 'ASC' },
        where: { subscriptionId },
      });
    if (bindings.length === 0) {
      throw new SystemMessageContractError('template_invalid');
    }
    return this.loadTemplatesByIds(
      manager,
      bindings.map((binding) => binding.templateId),
    );
  }

  /**
   * 按模板所属消息源的字段定义接收字符串配置，并拒绝额外或缺失字段。
   * @param input - 待校验的来源筛选配置。
   * @param definition - 模板绑定消息源公开的订阅字段定义。
   * @returns 仅含允许字段的字符串配置。
   * @throws 配置结构、字段类型或必填项不符合定义时抛出契约错误。
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
   * 按字段名升序重建来源配置，使等价筛选条件生成相同摘要。
   * @param config - 已通过消息源字段约束的字符串配置。
   * @returns 键顺序稳定的新配置对象。
   */
  private sortConfig(config: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(config).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  /**
   * 在写事务中锁定未删除订阅，防止并发更新覆盖软删除或身份变更。
   * @param repository - 当前事务中的消息订阅仓储。
   * @param id - 待锁定的消息订阅标识。
   * @returns 已锁定且未删除的消息订阅。
   * @throws 订阅不存在时抛出契约错误。
   */
  private async findActiveForWrite(
    repository: Repository<MessageSubscription>,
    id: string,
  ): Promise<MessageSubscription> {
    const current = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id, isDeleted: false },
    });
    if (!current) throw new SystemMessageContractError('invalid_source_config');
    return current;
  }

  /**
   * 在订阅写事务中先清除旧关联再按输入顺序写入完整集合，防止模板删减后残留旧绑定。
   * @param manager - 与消息订阅保存共享事务的实体管理器。
   * @param subscriptionId - 待替换模板集合的消息订阅标识。
   * @param templateIds - 已校验为同源且无重复的有序模板标识。
   */
  private async synchronizeTemplateBindings(
    manager: EntityManager,
    subscriptionId: string,
    templateIds: string[],
  ): Promise<void> {
    const repository = manager.getRepository(MessageSubscriptionTemplate);
    await repository.delete({ subscriptionId });
    await repository.save(
      templateIds.map((templateId, sortOrder) =>
        repository.create({
          sortOrder,
          subscriptionId,
          templateId,
        }),
      ),
    );
  }

  /**
   * 询问订阅声明的唯一订阅者是否仍保存私有配置，存在时拒绝切换或删除。
   * @param manager - 与订阅更新共享事务的实体管理器。
   * @param subscriptionId - 待检查的消息订阅标识。
   * @param subscriberKey - 当前负责该订阅的订阅者键。
   * @throws 订阅者仍引用该订阅时抛出契约错误。
   */
  private async assertNoLiveBindings(
    manager: EntityManager,
    subscriptionId: string,
    subscriberKey: string,
  ): Promise<void> {
    const subscriber = this.subscriberRegistry.require(subscriberKey);
    if (await subscriber.hasSubscriptionReferences(manager, subscriptionId)) {
      throw new SystemMessageContractError('invalid_source_config');
    }
  }

  /**
   * 仅通知订阅声明的订阅者取消未完成投递，避免其他订阅者越权扫描该订阅。
   * @param manager - 与订阅状态变更共享事务的实体管理器。
   * @param subscriberKey - 负责取消私有投递的订阅者键。
   * @param subscriptionId - 待取消未完成投递的消息订阅标识。
   * @param includeProcessing - 是否同时取消已经领取的处理中投递。
   */
  private async cancelUnfinishedDeliveries(
    manager: EntityManager,
    subscriberKey: string,
    subscriptionId: string,
    includeProcessing = false,
  ): Promise<void> {
    const subscriber = this.subscriberRegistry.require(subscriberKey);
    await subscriber.cancelSubscriptionDeliveries(manager, {
      includeProcessing,
      subscriptionId,
    });
  }

  /**
   * 把同模板、订阅者和来源配置的重复订阅转换为 HTTP 409 业务错误。
   * @returns 该方法不会正常返回。
   */
  private throwNaturalKeyConflict(): never {
    return throwVbenError(
      '相同模板、订阅者和消息源配置的订阅已存在',
      HttpStatus.CONFLICT,
    );
  }

  /**
   * 仅识别 MySQL 唯一键冲突，其他持久化异常继续交给调用方处理。
   * @param error - 保存订阅时捕获的未知异常。
   * @returns 异常属于 MySQL 唯一键冲突时返回 true。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  /**
   * 将订阅与其全部有序模板、消息源和订阅者投影为管理端视图。
   * @param subscription - 待投影的消息订阅持久化记录。
   * @returns 包含模板、来源、订阅者名称和配置有效性的订阅视图。
   */
  private async toView(
    subscription: MessageSubscription,
  ): Promise<MessageSubscriptionView> {
    const bindings = await this.subscriptionRepository.manager
      .getRepository(MessageSubscriptionTemplate)
      .find({
        order: { sortOrder: 'ASC' },
        where: { subscriptionId: subscription.id },
      });
    let templateRecords: MessageTemplate[] = [];
    if (bindings.length > 0) {
      templateRecords = await this.templateRepository.find({
        where: { id: In(bindings.map((binding) => binding.templateId)) },
      });
    }
    const templateById = new Map(
      templateRecords.map((template) => [String(template.id), template]),
    );
    const templates = bindings.flatMap((binding) => {
      const template = templateById.get(binding.templateId);
      if (!template) return [];
      return [{ binding, template }];
    });
    let sourceKey = '';
    let sourceName = '';
    let sourceSummary = '';
    let invalidReasonCode: null | string = null;
    let valid = true;
    const subscriber = this.subscriberRegistry.require(
      subscription.subscriberKey,
    );
    if (bindings.length === 0 || templates.length !== bindings.length) {
      valid = false;
      invalidReasonCode = 'template_invalid';
    } else {
      sourceKey = templates[0].template.sourceKey;
      const invalidTemplate = templates.some(
        ({ template }) =>
          template.isDeleted ||
          !template.enabled ||
          template.sourceKey !== sourceKey,
      );
      const source = this.sourceRegistry.get(sourceKey);
      sourceName = source.definition.displayName;
      const inspection = await source.inspectSubscription(
        subscription.sourceConfig,
      );
      sourceSummary = inspection.sourceSummary;
      valid = inspection.valid && !invalidTemplate;
      invalidReasonCode = inspection.invalidReasonCode;
      if (invalidTemplate) invalidReasonCode = 'template_invalid';
    }
    return {
      createTime: this.serializeTime(subscription.createTime),
      enabled: subscription.enabled,
      id: String(subscription.id),
      invalidReasonCode,
      name: subscription.name,
      remark: this.normalizeRemark(subscription.remark),
      sourceConfig: structuredClone(
        subscription.sourceConfig,
      ) as unknown as MessageSubscriptionView['sourceConfig'],
      sourceKey,
      sourceName,
      sourceSummary,
      subscriberKey: subscription.subscriberKey,
      subscriberName: subscriber.definition.displayName,
      templates: templates.map(({ binding, template }) => ({
        id: String(template.id),
        name: template.name,
        sortOrder: binding.sortOrder,
      })),
      updateTime: this.serializeTime(subscription.updateTime),
      valid,
    };
  }

  /**
   * 将数据库时间包装值转换为接口稳定使用的字符串。
   * @param value - 消息订阅的创建或更新时间。
   * @returns 时间值的字符串表示。
   */
  private serializeTime(value: MessageSubscription['createTime']): string {
    return String(value);
  }

  /**
   * 把可选备注裁剪为空值或无首尾空白的稳定文本。
   * @param value - 外部输入或数据库读取的可选备注。
   * @returns 空备注为 null，否则返回裁剪后的文本。
   */
  private normalizeRemark(value: null | string | undefined): null | string {
    const normalized = value?.trim();
    if (!normalized) return null;
    return normalized;
  }
}
