import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { validateDataValues } from '@/common/automation/data-schema';
import { DefinitionRepository, validateDefinitionInput } from '@/common/automation/definition.repository';
import { publishedReference, type PublishedReference } from '@/common/automation/definition.types';
import type { FormDefinition, FormDefinitionPort } from '../contract/form.types';
import { normalizeFormDefinition } from '../domain/form.policy';
import { FormDraft, FormRevision } from '../infrastructure/persistence/form.entities';

@Injectable()
export class FormDefinitionService implements FormDefinitionPort {
  readonly definitions: DefinitionRepository<FormDefinition>;

  constructor(database: DataSource) {
    this.definitions = new DefinitionRepository(database, FormDraft, FormRevision, normalizeFormDefinition);
  }

  /**
   * 按固定发布版本读取表单结构，旧流程不会跟随当前草稿改变。
   * @param reference - 表单资源及固定版本。
   * @returns 不包含任何实例填写数据的表单定义。
   */
  async resolve(reference: PublishedReference) {
    return this.definitions.published(validateDefinitionInput(() => publishedReference(reference)));
  }

  /**
   * 在服务端依据表单版本和消费方授权字段校验提交值，表单模块不保存实例状态。
   * @param reference - 发起流程时固定的表单版本。
   * @param input - 本次提交的填写值。
   * @param writableFields - 由消费方身份策略决定的可写字段。
   * @returns 经严格校验的表单数据。
   */
  async validate(reference: PublishedReference, input: unknown, writableFields?: readonly string[]) {
    const definition = await this.resolve(reference);
    return validateDefinitionInput(() => validateDataValues(definition.dataSchema, input, writableFields));
  }

  /**
   * 在表单设计器中检验草稿和样例填写值，不创建流程或修改实例。
   * @param input - 尚未发布的表单结构。
   * @param values - 预览页面中的填写值。
   * @returns 规范化定义和通过校验的填写值。
   */
  preview(input: unknown, values: unknown) {
    return validateDefinitionInput(() => {
      const definition = normalizeFormDefinition(input);
      return { definition, values: validateDataValues(definition.dataSchema, values) };
    });
  }
}
