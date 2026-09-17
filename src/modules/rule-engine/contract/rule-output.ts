import type { DataSchema } from '@/common/automation/data-schema';
import type { RuleDefinition } from './rule.types';

/**
 * 将已校验规则的统一结果类型公开为字段契约，空值决策没有可绑定的标量字段。
 * @param definition - 条件规则或所有分支结果同类型的固定决策表。
 * @returns 可供工作流和其他消费方绑定的结果字段。
 */
export function ruleOutputSchema(definition: RuleDefinition): DataSchema {
  let type = 'boolean';
  if (definition.mode === 'decision-table')
    type = typeof definition.defaultResult;
  if (type !== 'boolean' && type !== 'number' && type !== 'string')
    return { fields: [] };
  return {
    fields: [{ key: 'result', label: '规则结果', type, required: true }],
  };
}
