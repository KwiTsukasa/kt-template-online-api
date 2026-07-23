import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
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
} from '../../contract/message-push/qqbot-message-push.types';
import { SystemMessageContractError } from '../../contract/message-push/qqbot-message-push.types';
import { QqbotMessagePublishBinding } from '../../infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessageTemplate } from '../../infrastructure/persistence/message-push/qqbot-message-template.entity';
import { SystemMessageSourceRegistry } from './system-message-source.registry';
import { SystemMessageTemplateRendererService } from './system-message-template-renderer.service';

const DEFAULT_PAGE_NO = 1;
const DEFAULT_PAGE_SIZE = 10;

/**
 * Manages reusable, source-scoped safe templates and the binding availability gate.
 *
 * Repository exceptions intentionally propagate so storage failures cannot be treated
 * as valid domain state.
 */
@Injectable()
export class QqbotMessageTemplateService {
  /**
   * Initializes template lifecycle dependencies.
   * @param templateRepository - Persistence for global message templates.
   * @param bindingRepository - Persistence used solely to count live template references.
   * @param sourceRegistry - Current process-local source definitions and allowed variables.
   * @param renderer - Shared strict parser and pure scalar renderer.
   */
  constructor(
    @InjectRepository(QqbotMessageTemplate)
    private readonly templateRepository: Repository<QqbotMessageTemplate>,
    @InjectRepository(QqbotMessagePublishBinding)
    private readonly bindingRepository: Repository<QqbotMessagePublishBinding>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly renderer: SystemMessageTemplateRendererService,
  ) {}

  /**
   * Pages non-deleted templates with source display names and live binding counts.
   * @param query - Optional name, source, enabled, and page filters.
   * @returns Visible template views and their total count; deleted templates never appear.
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
    const where: FindOptionsWhere<QqbotMessageTemplate> = { isDeleted: false };
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
   * Creates one source-valid global template.
   * @param input - Template metadata, source identity, content, and initial enabled state.
   * @returns The persisted template view with a zero or current reference count.
   */
  async create(input: MessageTemplateInput): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.save(
      this.templateRepository.create(this.toPersistenceInput(input)),
    );
    return this.toView(saved);
  }

  /**
   * Updates one non-deleted template after revalidating it against the current source.
   * @param id - String Snowflake identity of the template.
   * @param input - Complete replacement metadata and content.
   * @returns The updated template view.
   */
  async update(
    id: string,
    input: MessageTemplateInput,
  ): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.manager.transaction(
      /** Holds the dependency row through reference counting and its source-safe save. */
      async (manager) => {
        const templateRepository = manager.getRepository(QqbotMessageTemplate);
        const bindingRepository = manager.getRepository(
          QqbotMessagePublishBinding,
        );
        const current = await templateRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id, isDeleted: false },
        });
        if (!current) throw new SystemMessageContractError('template_invalid');
        if (current.sourceKey !== input.sourceKey) {
          const referenceCount = await bindingRepository.count({
            where: { isDeleted: false, templateId: id },
          });
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
   * Toggles one template, revalidating historical content before it can be enabled.
   * @param id - String Snowflake identity of the template.
   * @param enabled - Requested future enabled state.
   * @returns The persisted template view; disabling leaves existing bindings untouched.
   */
  async setEnabled(id: string, enabled: boolean): Promise<MessageTemplateView> {
    const current = await this.findActive(id);
    if (enabled) this.validateContent(current.content, current.sourceKey);
    current.enabled = enabled;
    return this.toView(await this.templateRepository.save(current));
  }

  /**
   * Soft-deletes a template that has no live publish binding references.
   * @param id - String Snowflake identity of the template.
   * @returns `true` after setting both `isDeleted` and `enabled` to false-safe values.
   * @throws {SystemMessageContractError} When any non-deleted binding still references it.
   */
  async remove(id: string): Promise<boolean> {
    return this.templateRepository.manager.transaction(
      /** Holds the template write lock until the reference check and soft deletion commit together. */
      async (manager) => {
        const templateRepository = manager.getRepository(QqbotMessageTemplate);
        const bindingRepository = manager.getRepository(
          QqbotMessagePublishBinding,
        );
        const current = await templateRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id, isDeleted: false },
        });
        if (!current) throw new SystemMessageContractError('template_invalid');

        const referenceCount = await bindingRepository.count({
          where: { isDeleted: false, templateId: id },
        });
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
   * Renders source examples through the production renderer without a parallel preview path.
   * @param input - Candidate content and its exact source identity.
   * @returns Rendered plain text and typed source example variables.
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
   * Enforces the template lock order before a publish binding is created, updated, or revived.
   *
   * Callers must invoke this inside their current transaction before saving a non-deleted
   * binding, and must retain that transaction through the binding save and commit. Disabled
   * bindings also require the lock because they still create a live template reference.
   * @param manager - Current binding-write transaction manager; never pass a global manager.
   * @param templateId - Candidate template's string Snowflake identity.
   * @param sourceKey - Source subscribed by the binding.
   * @param bindingEnabled - Whether the binding is being created or enabled for delivery.
   * @returns The existing non-deleted template when it is valid for this binding state.
   * @throws {SystemMessageContractError} With `template_invalid` for every unavailable binding choice.
   */
  async requireAvailableForBinding(
    manager: EntityManager,
    templateId: string,
    sourceKey: string,
    bindingEnabled: boolean,
  ): Promise<QqbotMessageTemplate> {
    const template = await manager.getRepository(QqbotMessageTemplate).findOne({
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
   * Validates a create or update payload using its currently registered source contract.
   * @param input - Candidate source key and template content.
   * @returns Nothing after successful strict rendering-protocol validation.
   */
  private validateInput(input: MessageTemplateInput): void {
    const definition = this.sourceRegistry.get(input.sourceKey).definition;
    this.renderer.validate(
      input.content,
      definition.variables.map((variable) => variable.key),
    );
  }

  /**
   * Revalidates stored content against the source definition currently in the registry.
   * @param content - Persisted or candidate template text.
   * @param sourceKey - Source whose exact current variables are authoritative.
   * @returns Nothing when content remains valid; parser errors retain their stable code.
   */
  private validateContent(content: string, sourceKey: string): void {
    const definition = this.sourceRegistry.get(sourceKey).definition;
    this.renderer.validate(
      content,
      definition.variables.map((variable) => variable.key),
    );
  }

  /**
   * Validates content for a newly enabled binding and maps a missing current source to the gate error.
   * @param content - Stored template text selected by the binding.
   * @param sourceKey - Source identity already matched to the subscription.
   * @returns Nothing when the current source still accepts this template.
   * @throws {SystemMessageContractError} With `template_invalid` when its source is unavailable or content is invalid.
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
   * Normalizes user-facing metadata into the entity fields shared by create and update.
   * @param input - Validated complete template input.
   * @returns Persistence fields with blank remarks represented as `null`.
   */
  private toPersistenceInput(
    input: MessageTemplateInput,
  ): Pick<
    QqbotMessageTemplate,
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
   * Loads an existing non-deleted template for a direct lifecycle operation.
   * @param id - String Snowflake identity to look up.
   * @returns The active entity or throws the stable template availability error.
   */
  private async findActive(id: string): Promise<QqbotMessageTemplate> {
    const template = await this.templateRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!template) throw new SystemMessageContractError('template_invalid');
    return template;
  }

  /**
   * Converts source definition examples to the scalar types used by actual rendering.
   * @param definition - Current source schema that owns variable examples and types.
   * @returns A source-keyed scalar object; invalid examples throw `template_invalid`.
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
   * Maps an entity to the external template contract without exposing datetime objects.
   * @param template - Persisted template entity.
   * @returns Serializable view including source display name and all live binding references.
   */
  private async toView(
    template: QqbotMessageTemplate,
  ): Promise<MessageTemplateView> {
    const [referenceCount, source] = await Promise.all([
      this.bindingRepository.count({
        where: { isDeleted: false, templateId: template.id },
      }),
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
   * Serializes project datetime values at the message-push JSON boundary.
   * @param value - Entity datetime value supplied by the KtDateTime TypeORM transformer.
   * @returns The project-configured KtDateTime string, without converting it to UTC ISO text.
   */
  private serializeTime(value: QqbotMessageTemplate['createTime']): string {
    return String(value);
  }
}
