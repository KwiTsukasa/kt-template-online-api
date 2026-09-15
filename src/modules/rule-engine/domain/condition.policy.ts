import { definitionRecord } from '@/common/automation/definition.types';
import type { RuleCondition, RuleConditionTrace, RuleScalar } from '../contract/rule.types';

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const scalarKinds = new Set(['boolean', 'number', 'string']);
const comparisonOperators = new Set([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'exists',
]);
const numericOperators = new Set(['gt', 'gte', 'lt', 'lte']);

/**
 * 校验规则标量，不进行字符串到数字或布尔值的隐式转换。
 * @param value - 条件右侧的原始值。
 * @returns 已校验的有限标量。
 * @throws 值为对象、非有限数字或过长字符串时抛出校验错误。
 */
function ruleScalar(value: unknown): RuleScalar {
  if (value === null) return null;
  if (
    !scalarKinds.has(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > 2048)
  ) {
    throw new Error('规则比较值必须是有界标量');
  }
  return value as RuleScalar;
}

/**
 * 将规则约束为有界声明式条件树，拒绝表达式代码、正则执行和原型路径。
 * @param input - 条件树；空值表示没有附加条件。
 * @returns 可安全求值的规范化条件树。
 * @throws 条件深度、节点数、路径或运算符非法时抛出校验错误。
 */
export function normalizeRuleCondition(input: unknown): RuleCondition | null {
  if (input === null || input === undefined) return null;
  let remaining = 64;
  const visit = (raw: unknown, depth: number): RuleCondition => {
    remaining -= 1;
    if (remaining < 0 || depth > 8)
      throw new Error('条件树超过 64 节点或 8 层限制');
    const item = definitionRecord(raw);
    if (item.type === 'all' || item.type === 'any') {
      if (
        !Array.isArray(item.rules) ||
        !item.rules.length ||
        item.rules.length > 32
      )
        throw new Error('条件组合必须包含 1 至 32 个子条件');
      return {
        type: item.type,
        rules: item.rules.map((child) => visit(child, depth + 1)),
      };
    }
    if (item.type === 'not')
      return { type: 'not', rule: visit(item.rule, depth + 1) };
    if (
      item.type !== 'compare' ||
      typeof item.path !== 'string' ||
      !/^[A-Za-z_][\w-]*(\.[A-Za-z_0-9][\w-]*)*$/.test(item.path) ||
      item.path.length > 256 ||
      item.path.split('.').some((key) => forbiddenKeys.has(key))
    ) {
      throw new Error('规则路径或节点类型不合法');
    }
    if (!comparisonOperators.has(String(item.operator)))
      throw new Error('规则运算符不支持');
    const operator = item.operator as Extract<
      RuleCondition,
      { type: 'compare' }
    >['operator'];
    let value: RuleScalar | RuleScalar[];
    if (operator === 'in') {
      if (
        !Array.isArray(item.value) ||
        !item.value.length ||
        item.value.length > 32
      )
        throw new Error('集合比较必须包含 1 至 32 个标量');
      value = item.value.map(ruleScalar);
    } else {
      value = ruleScalar(item.value);
    }
    if (numericOperators.has(operator) && typeof value !== 'number')
      throw new Error('大小比较要求数字');
    if (operator === 'exists' && typeof value !== 'boolean')
      throw new Error('存在性比较要求布尔值');
    return { type: 'compare', path: item.path, operator, value };
  };
  return visit(input, 0);
}

/**
 * 仅沿自有数据字段读取规则路径，不访问原型、调用函数或展开表达式。
 * @param input - 已校验的任务输入。
 * @param path - 已校验的点分路径。
 * @returns 路径对应的值；任一字段缺失时返回未定义。
 */
function pathValue(input: Record<string, unknown>, path: string): unknown {
  let current: unknown = input;
  for (const key of path.split('.')) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, key)
    )
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * 按严格类型求值声明式条件；缺失数字和字符串字段不会因类型转换命中条件。
 * @param rule - 已规范化并持久化的条件树。
 * @param input - 经过 JSON 边界校验的任务输入。
 * @returns 所有条件约束是否满足；空条件直接通过。
 */
export function matchesRuleCondition(
  rule: RuleCondition | null,
  input: Record<string, unknown>,
): boolean {
  if (!rule) return true;
  if (rule.type === 'all')
    return rule.rules.every((child) => matchesRuleCondition(child, input));
  if (rule.type === 'any')
    return rule.rules.some((child) => matchesRuleCondition(child, input));
  if (rule.type === 'not') return !matchesRuleCondition(rule.rule, input);
  if (rule.type !== 'compare') return false;
  const left = pathValue(input, rule.path);
  const right = rule.value;
  if (rule.operator === 'exists') return (left !== undefined) === right;
  if (rule.operator === 'eq') return left === right;
  if (rule.operator === 'ne') return left !== right;
  if (rule.operator === 'in' && Array.isArray(right))
    return right.some((candidate) => candidate === left);
  if (rule.operator === 'contains') {
    if (typeof left === 'string' && typeof right === 'string')
      return left.includes(right);
    if (Array.isArray(left))
      return left.some((candidate) => candidate === right);
    return false;
  }
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  if (rule.operator === 'gt') return left > right;
  if (rule.operator === 'gte') return left >= right;
  if (rule.operator === 'lt') return left < right;
  if (rule.operator === 'lte') return left <= right;
  return false;
}

/**
 * 求值每个声明式子条件并保留树位置，解释中不复制事实值，且不使用短路遗漏未命中的条件。
 * @param rule - 已校验且有深度与节点数上限的条件树。
 * @param input - 已通过事实结构校验的数据。
 * @param location - 当前树或决策行在定义内的位置。
 * @returns 根结果与按父节点优先排列的条件解释。
 */
export function explainRuleCondition(
  rule: RuleCondition,
  input: Record<string, unknown>,
  location: string,
): { matched: boolean; trace: RuleConditionTrace[] } {
  const trace: RuleConditionTrace[] = [];
  let matched: boolean;
  if (rule.type === 'all' || rule.type === 'any') {
    const children = rule.rules.map((child, index) => explainRuleCondition(child, input, `${location}.${index}`));
    matched = children.every((child) => child.matched);
    if (rule.type === 'any') matched = children.some((child) => child.matched);
    trace.push(...children.flatMap((child) => child.trace));
  } else if (rule.type === 'not') {
    const child = explainRuleCondition(rule.rule, input, `${location}.0`);
    matched = !child.matched;
    trace.push(...child.trace);
  } else {
    matched = matchesRuleCondition(rule, input);
  }
  const current: RuleConditionTrace = { location, type: rule.type, matched };
  if (rule.type === 'compare') {
    current.field = rule.path;
    current.operator = rule.operator;
  }
  return { matched, trace: [current, ...trace] };
}
