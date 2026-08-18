import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  Like,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import type {
  MessageTemplateInput,
  MessageTemplateListQuery,
  MessageTemplatePreview,
  MessageTemplateView,
  SystemMessageSourceDefinition,
} from '../contract/message-management.types';
import { SystemMessageContractError } from '../contract/message-management.types';
import { MessageSubscription } from '../infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../infrastructure/persistence/message-template.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const DEFAULT_PAGE_NO = 1;
const DEFAULT_PAGE_SIZE = 10;

@Injectable()
export class MessageTemplateService {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly renderer: SystemMessageTemplateRendererService,
  ) {}

  /**
   * 查询领域服务并组装管理端页面。
   * @param query - 限定消息管理分页结果筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`name`、`sourceKey` 字段。
   * @returns 包含 `items`、`total` 字段的消息管理分页；没有匹配项时为空数组。
   */
  async page(query: MessageTemplateListQuery): Promise<{
    items: MessageTemplateView[];
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
    const where: FindOptionsWhere<MessageTemplate> = { isDeleted: false };
    if (query.name) where.name = Like(`%${query.name}%`);
    if (query.sourceKey) where.sourceKey = query.sourceKey;
    if (query.enabled !== undefined) where.enabled = query.enabled;

    const [templates, total] = await this.templateRepository.findAndCount({
      order: { createTime: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where,
    });
    return {
      items: await Promise.all(templates.map((item) => this.toView(item))),
      total,
    };
  }

  /**
   * 根据`input`构造消息模板记录；把变更持久化到当前存储（`templateRepository.save`）。
   * @param input - 用于消息模板记录的结构化输入。
   * @returns 消息模板记录。
   */
  async create(input: MessageTemplateInput): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.save(
      this.templateRepository.create(this.toPersistenceInput(input)),
    );
    return this.toView(saved);
  }

  /**
   * 根据`id`、`input`更新消息模板记录；先通过 `validateInput` 校验输入边界。
   * @param id - 决定消息模板记录内容、边界或目标的 `id` 值。
   * @param input - 用于消息模板记录的结构化输入，包含 `sourceKey` 字段。
   * @returns 消息模板记录。
   */
  async update(
    id: string,
    input: MessageTemplateInput,
  ): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.manager.transaction(
      async (manager) => {
        const templateRepository = manager.getRepository(MessageTemplate);
        const current = await templateRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id, isDeleted: false },
        });
        if (!current) throw new SystemMessageContractError('template_invalid');
        if (current.sourceKey !== input.sourceKey) {
          const referenceCount = await this.countTemplateReferences(
            manager,
            id,
          );
          if (referenceCount > 0) {
            throw new SystemMessageContractError('template_invalid');
          }
        }
        Object.assign(current, this.toPersistenceInput(input));
        return templateRepository.save(current);
      },
    );
    return this.toView(saved);
  }

  /**
   * 根据`id`、`enabled`更新启用；把变更持久化到当前存储（`templateRepository.save`）。
   * @param id - 决定启用内容、边界或目标的 `id` 值。
   * @param enabled - 决定启用内容、边界或目标的 `enabled` 值。
   * @returns 启用。
   */
  async setEnabled(id: string, enabled: boolean): Promise<MessageTemplateView> {
    const current = await this.findActive(id);
    if (enabled) this.validateContent(current.content, current.sourceKey);
    current.enabled = enabled;
    return this.toView(await this.templateRepository.save(current));
  }

  /**
   * 按`id`移除消息模板记录。
   * @param id - 决定消息模板记录内容、边界或目标的 `id` 值。
   * @returns 消息模板记录。
   */
  async remove(id: string): Promise<boolean> {
    return this.templateRepository.manager.transaction(
      // 保持模板行锁，直至引用检查与软删除在同一事务提交。
      async (manager) => {
        const templateRepository = manager.getRepository(MessageTemplate);
        const current = await templateRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id, isDeleted: false },
        });
        if (!current) throw new SystemMessageContractError('template_invalid');

        const referenceCount = await this.countTemplateReferences(manager, id);
        if (referenceCount > 0) {
          throw new SystemMessageContractError('template_invalid');
        }
        current.enabled = false;
        current.isDeleted = true;
        await templateRepository.save(current);
        return true;
      },
    );
  }

  /**
   * 查询领域服务并组装管理端预览。
   * @param input - 用于预览的结构化输入，包含 `sourceKey`、`content` 字段。
   * @returns 包含 `renderedMessage`、`variables` 字段的预览。
   */
  preview(input: {
    content: string;
    sourceKey: string;
  }): MessageTemplatePreview {
    const definition = this.sourceRegistry.get(input.sourceKey).definition;
    const variables = this.exampleVariables(definition);
    return {
      renderedMessage: this.renderer.render(input.content, variables),
      variables,
    };
  }

  /**
   * 加载指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用。
   * @param manager - 保证指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用读写处于同一事务中的实体管理器。
   * @param templateId - 用于精确定位template的标识。
   * @param sourceKey - 用于读取或更新指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用的稳定键。
   * @param bindingEnabled - 决定指定订阅或模板，校验其存在、启用且与消息来源配置一致后供绑定流程使用内容、边界或目标的 `bindingEnabled` 值。
   * @returns 返回已验证可绑定的订阅或模板记录。
   * @throws 当 `!template || template.sourceKey !== sourceKey` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `!template.enabled` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  async requireAvailableForBinding(
    manager: EntityManager,
    templateId: string,
    sourceKey: string,
    bindingEnabled: boolean,
  ): Promise<MessageTemplate> {
    const template = await manager.getRepository(MessageTemplate).findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id: templateId, isDeleted: false },
    });
    if (!template || template.sourceKey !== sourceKey) {
      throw new SystemMessageContractError('template_invalid');
    }
    if (bindingEnabled) {
      if (!template.enabled)
        throw new SystemMessageContractError('template_invalid');
      this.validateContentForBinding(template.content, template.sourceKey);
    }
    return template;
  }

  /**
   * 校验`input`是否满足输入约束，并拒绝不合法输入；先通过 `renderer.validate` 校验输入边界。
   * @param input - 用于输入的结构化输入，包含 `sourceKey`、`content` 字段。
   */
  private validateInput(input: MessageTemplateInput): void {
    const definition = this.sourceRegistry.get(input.sourceKey).definition;
    this.renderer.validate(
      input.content,
      definition.variables.map((variable) => variable.key),
    );
  }

  /**
   * 校验`content`、`sourceKey`是否满足内容约束，并拒绝不合法输入；先通过 `renderer.validate` 校验输入边界。
   * @param content - 决定内容、边界或目标的 `content` 值。
   * @param sourceKey - 用于读取或更新内容的稳定键。
   */
  private validateContent(content: string, sourceKey: string): void {
    const definition = this.sourceRegistry.get(sourceKey).definition;
    this.renderer.validate(
      content,
      definition.variables.map((variable) => variable.key),
    );
  }

  /**
   * 校验`content`、`sourceKey`是否满足内容用于绑定约束，并拒绝不合法输入；先通过 `validateContent` 校验输入边界。
   * @param content - 决定内容用于绑定内容、边界或目标的 `content` 值。
   * @param sourceKey - 用于读取或更新内容用于绑定的稳定键。
   * @throws 当 `error instanceof SystemMessageContractError && error.code === 'unknown_…` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `validateContent` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private validateContentForBinding(content: string, sourceKey: string): void {
    try {
      this.validateContent(content, sourceKey);
    } catch (error) {
      if (
        error instanceof SystemMessageContractError &&
        error.code === 'unknown_message_source'
      ) {
        throw new SystemMessageContractError('template_invalid');
      }
      throw error;
    }
  }

  /**
   * 将输入收敛并投影为持久化输入。
   * @param input - 用于持久化输入的结构化输入，包含 `content`、`enabled`、`name`、`remark` 字段。
   * @returns 包含 `content`、`enabled`、`name`、`remark`、`sourceKey` 字段的持久化输入。
   */
  private toPersistenceInput(
    input: MessageTemplateInput,
  ): Pick<
    MessageTemplate,
    'content' | 'enabled' | 'name' | 'remark' | 'sourceKey'
  > {
    return {
      content: input.content,
      enabled: input.enabled,
      name: input.name.trim(),
      remark: input.remark?.trim() || null,
      sourceKey: input.sourceKey,
    };
  }

  /**
   * 按`id`读取启用的；从 `templateRepository.findOne` 读取启用的。
   * @param id - 决定启用的内容、边界或目标的 `id` 值。
   * @returns 启用的。
   * @throws 当 `!template` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  private async findActive(id: string): Promise<MessageTemplate> {
    const template = await this.templateRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!template) throw new SystemMessageContractError('template_invalid');
    return template;
  }

  /**
   * 按变量定义构造模板预览示例值。
   * @param definition - 用于按变量定义构造模板预览示例值的领域对象，包含 `variables` 字段。
   * @returns 按变量定义构造模板预览示例值。
   */
  private exampleVariables(
    definition: SystemMessageSourceDefinition,
  ): Record<string, boolean | number | string> {
    return Object.fromEntries(
      definition.variables.map((variable) => {
        if (variable.type === 'string') return [variable.key, variable.example];
        if (variable.type === 'number') {
          const value = Number(variable.example);
          if (!Number.isFinite(value)) {
            throw new SystemMessageContractError('template_invalid');
          }
          return [variable.key, value];
        }
        if (variable.example === 'true') return [variable.key, true];
        if (variable.example === 'false') return [variable.key, false];
        throw new SystemMessageContractError('template_invalid');
      }),
    );
  }

  /**
   * 将输入收敛并投影为视图。
   * @param template - 用于视图的领域对象，包含 `id`、`sourceKey`、`content`、`createTime` 字段。
   * @returns 包含 `content`、`createTime`、`enabled`、`id`、`name` 字段的视图。
   */
  private async toView(
    template: MessageTemplate,
  ): Promise<MessageTemplateView> {
    const [referenceCount, source] = await Promise.all([
      this.countTemplateReferences(
        this.templateRepository.manager,
        template.id,
      ),
      Promise.resolve(this.sourceRegistry.get(template.sourceKey).definition),
    ]);
    return {
      content: template.content,
      createTime: this.serializeTime(template.createTime),
      enabled: template.enabled,
      id: String(template.id),
      name: template.name,
      referenceCount,
      remark: template.remark?.trim() || null,
      sourceKey: template.sourceKey,
      sourceName: source.displayName,
      updateTime: this.serializeTime(template.updateTime),
    };
  }

  /**
   * 将`value`转换为序列化时间。
   * @param value - 待转换为序列化时间的原始值。
   * @returns 序列化时间。
   */
  private serializeTime(value: MessageTemplate['createTime']): string {
    return String(value);
  }

  /**
   * 统计直接绑定指定模板的有效消息订阅，不读取任何订阅者私有配置表。
   * @param manager - 与模板变更共享事务的实体管理器。
   * @param templateId - 需要统计引用的消息模板标识。
   * @returns 未删除消息订阅对该模板的引用数。
   */
  private async countTemplateReferences(
    manager: EntityManager,
    templateId: string,
  ): Promise<number> {
    const bindings = await manager
      .getRepository(MessageSubscriptionTemplate)
      .find({
        select: { subscriptionId: true },
        where: { templateId },
      });
    if (bindings.length === 0) return 0;
    return manager.getRepository(MessageSubscription).count({
      where: {
        id: In([...new Set(bindings.map((binding) => binding.subscriptionId))]),
        isDeleted: false,
      },
    });
  }
}
