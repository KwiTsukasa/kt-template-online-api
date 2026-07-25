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

@Injectable()
export class QqbotMessageTemplateService {
  constructor(
    @InjectRepository(QqbotMessageTemplate)
    private readonly templateRepository: Repository<QqbotMessageTemplate>,
    @InjectRepository(QqbotMessagePublishBinding)
    private readonly bindingRepository: Repository<QqbotMessagePublishBinding>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly renderer: SystemMessageTemplateRendererService,
  ) {}

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

  async create(input: MessageTemplateInput): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.save(
      this.templateRepository.create(this.toPersistenceInput(input)),
    );
    return this.toView(saved);
  }

  async update(
    id: string,
    input: MessageTemplateInput,
  ): Promise<MessageTemplateView> {
    this.validateInput(input);
    const saved = await this.templateRepository.manager.transaction(
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

  async setEnabled(id: string, enabled: boolean): Promise<MessageTemplateView> {
    const current = await this.findActive(id);
    if (enabled) this.validateContent(current.content, current.sourceKey);
    current.enabled = enabled;
    return this.toView(await this.templateRepository.save(current));
  }

  async remove(id: string): Promise<boolean> {
    return this.templateRepository.manager.transaction(
      // 保持模板行锁，直至引用检查与软删除在同一事务提交。
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

  private validateInput(input: MessageTemplateInput): void {
    const definition = this.sourceRegistry.get(input.sourceKey).definition;
    this.renderer.validate(
      input.content,
      definition.variables.map((variable) => variable.key),
    );
  }

  private validateContent(content: string, sourceKey: string): void {
    const definition = this.sourceRegistry.get(sourceKey).definition;
    this.renderer.validate(
      content,
      definition.variables.map((variable) => variable.key),
    );
  }

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

  private async findActive(id: string): Promise<QqbotMessageTemplate> {
    const template = await this.templateRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!template) throw new SystemMessageContractError('template_invalid');
    return template;
  }

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

  private serializeTime(value: QqbotMessageTemplate['createTime']): string {
    return String(value);
  }
}
