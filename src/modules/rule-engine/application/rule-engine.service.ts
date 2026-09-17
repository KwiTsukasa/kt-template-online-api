import { requireRequest } from '@/common/automation/validation';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DefinitionRepository,
  validateDefinitionInput,
} from '@/common/automation/definition.repository';
import {
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import type { RuleDefinition, RuleEnginePort } from '../contract/rule.types';
import {
  evaluateRuleDefinition,
  normalizeRuleDefinition,
} from '../domain/rule.policy';
import {
  RuleDraft,
  RuleRevision,
} from '../infrastructure/persistence/rule.entities';

@Injectable()
export class RuleEngineService implements RuleEnginePort {
  readonly definitions: DefinitionRepository<RuleDefinition>;

  constructor(database: DataSource) {
    this.definitions = new DefinitionRepository(
      database,
      RuleDraft,
      RuleRevision,
      normalizeRuleDefinition,
    );
  }

  /**
   * 解析规则的固定发布版本，不读取可变草稿。
   * @param reference - 规则资源及发布版本。
   * @returns 固定的规则定义。
   */
  async resolve(reference: PublishedReference) {
    return this.definitions.published(
      validateDefinitionInput(() => publishedReference(reference)),
    );
  }

  /**
   * 对指定规则版本输入事实并返回纯决策结果，不调用调度器或业务处理器。
   * @param reference - 固定的规则版本。
   * @param facts - 当前运行提供的事实值。
   * @returns 条件结果或决策表命中行。
   */
  async evaluate(reference: PublishedReference, facts: unknown) {
    const definition = await this.resolve(reference);
    return validateDefinitionInput(() =>
      evaluateRuleDefinition(definition, facts),
    );
  }

  /**
   * 对设计器草稿执行当前事实预览及已保存用例，供发布前定位不符合预期的规则。
   * @param input - 规则编辑器中的草稿定义。
   * @param facts - 本次交互测试输入。
   * @returns 当前求值结果与每条保存用例的实际值和通过状态。
   */
  preview(input: unknown, facts: unknown) {
    return validateDefinitionInput(() => {
      const definition = normalizeRuleDefinition(input);
      const cases = definition.testCases.map((item) => {
        const actual = evaluateRuleDefinition(definition, item.facts);
        return {
          name: item.name,
          expected: item.expected,
          actual: actual.result,
          passed: actual.result === item.expected,
        };
      });
      return { ...evaluateRuleDefinition(definition, facts), cases };
    });
  }

  /**
   * 发布前重新运行规则保存的验收用例，防止把已知不满足预期的草稿冻结为版本。
   * @param definition - 在事务锁内重新校验的规则草稿。
   * @throws 任一保存用例失败时拒绝发布。
   */
  async checkForPublish(definition: RuleDefinition): Promise<void> {
    const failed = definition.testCases.filter(
      (item) =>
        evaluateRuleDefinition(definition, item.facts).result !== item.expected,
    );
    requireRequest(
      !failed.length,
      `规则测试未通过：${failed.map((item) => item.name).join('、')}`,
    );
  }
}
