import { normalizeDataSchema, validateDataValues } from '@/common/automation/data-schema';
import { definitionRecord } from '@/common/automation/definition.types';
import type { RuleCondition, RuleDefinition, RuleEvaluation, RuleScalar } from '../contract/rule.types';
import { explainRuleCondition, normalizeRuleCondition } from './condition.policy';

/**
 * 限制决策结果为有界标量，确保持久版本不包含可执行对象。
 * @param value - 决策行或缺省分支的输出。
 * @returns 可以序列化和严格比较的决策值。
 * @throws 对象、无穷数或超长文本被拒绝。
 */
function decisionValue(value: unknown): RuleScalar {
  if (value === null || typeof value === 'boolean') return value as RuleScalar;
  if (typeof value === 'string' && value.length <= 2048) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('决策结果必须是有界标量');
}

/**
 * 约束条件只能引用事实目录中声明的字段，并使用该字段支持的运算符。
 * @param rule - 经过语法规范化的条件树。
 * @param definition - 提供事实字段结构的规则定义。
 * @throws 条件引用未知字段或运算符与字段类型不相容时拒绝保存。
 */
function validateConditionFacts(rule: RuleCondition, definition: Pick<RuleDefinition, 'factSchema'>): void {
  if (rule.type === 'all' || rule.type === 'any') {
    for (const child of rule.rules) validateConditionFacts(child, definition);
    return;
  }
  if (rule.type === 'not') {
    validateConditionFacts(rule.rule, definition);
    return;
  }
  if (rule.type !== 'compare') return;
  const field = definition.factSchema.fields.find((candidate) => candidate.key === rule.path);
  if (!field) throw new Error(`条件引用了未声明的事实：${rule.path}`);
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.operator) && field.type !== 'number' && field.type !== 'integer') throw new Error(`${field.label}：大小比较要求数字字段`);
  if (rule.operator === 'contains' && field.type !== 'string') throw new Error(`${field.label}：包含运算要求文本字段`);
  if (rule.operator === 'exists') return;
  const expectedType = field.type.replace('integer', 'number');
  let values = [rule.value];
  if (Array.isArray(rule.value)) values = rule.value;
  if (values.some((value) => typeof value !== expectedType)) throw new Error(`${field.label}：比较值类型与事实不一致`);
}

/**
 * 规范化独立规则资源，同时校验事实目录、条件或决策表以及已保存的测试用例。
 * @param input - 规则编辑器输出的结构化定义。
 * @returns 可发布且不依赖任何调度或插件实现的规则。
 * @throws 模式、字段引用、条件、决策行或测试数据非法时拒绝保存。
 */
export function normalizeRuleDefinition(input: unknown): RuleDefinition {
  const source = definitionRecord(input);
  if (source.schemaVersion !== 1) throw new Error('规则结构版本不支持');
  const factSchema = normalizeDataSchema(source.factSchema);
  if (!Array.isArray(source.testCases) || source.testCases.length > 32) throw new Error('规则测试用例最多 32 个');
  const testCases = source.testCases.map((raw) => {
    const item = definitionRecord(raw);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128) throw new Error('测试用例名称不合法');
    return { name: item.name.trim(), facts: validateDataValues(factSchema, item.facts), expected: decisionValue(item.expected) };
  });
  const common = { schemaVersion: 1 as const, factSchema, testCases };
  if (source.mode === 'condition') {
    const condition = normalizeRuleCondition(source.condition);
    if (!condition) throw new Error('条件规则不能为空');
    validateConditionFacts(condition, common);
    if (testCases.some((item) => typeof item.expected !== 'boolean')) throw new Error('条件规则的测试结果必须是布尔值');
    return { ...common, mode: 'condition', condition };
  }
  if (source.mode !== 'decision-table' || !Array.isArray(source.rows) || source.rows.length < 1 || source.rows.length > 64) throw new Error('决策表需要 1 至 64 行');
  const defaultResult = decisionValue(source.defaultResult);
  const ids = new Set<string>();
  const rows = source.rows.map((raw) => {
    const row = definitionRecord(raw);
    if (typeof row.id !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(row.id) || ids.has(row.id)) throw new Error('决策行标识不合法或重复');
    ids.add(row.id);
    const condition = normalizeRuleCondition(row.condition);
    if (!condition) throw new Error('决策行条件不能为空');
    validateConditionFacts(condition, common);
    const result = decisionValue(row.result);
    if (typeof result !== typeof defaultResult || (result === null) !== (defaultResult === null)) throw new Error('决策表各分支必须输出相同类型');
    return { id: row.id, condition, result };
  });
  return { ...common, mode: 'decision-table', rows, defaultResult };
}

/**
 * 校验事实后进行纯条件求值，决策表采用从上往下首条匹配语义。
 * @param definition - 已规范化的规则版本。
 * @param input - 调用方提供的事实值。
 * @returns 决策值、命中的决策行及已判断条件的解释，不执行业务动作或暴露事实值。
 */
export function evaluateRuleDefinition(definition: RuleDefinition, input: unknown): RuleEvaluation {
  const facts = validateDataValues(definition.factSchema, input);
  if (definition.mode === 'condition') {
    const evaluated = explainRuleCondition(definition.condition, facts, 'condition');
    return { result: evaluated.matched, matchedRowId: null, trace: evaluated.trace };
  }
  const trace: RuleEvaluation['trace'] = [];
  for (const row of definition.rows) {
    const evaluated = explainRuleCondition(row.condition, facts, `rows.${row.id}`);
    trace.push(...evaluated.trace);
    if (evaluated.matched) return { result: row.result, matchedRowId: row.id, trace };
  }
  return { result: definition.defaultResult, matchedRowId: null, trace };
}
