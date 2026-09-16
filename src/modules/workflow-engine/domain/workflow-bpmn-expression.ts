import type { ValueBinding, ValueReference } from '../contract/workflow.types';

/**
 * 校验多实例次数并还原业务字段引用，拒绝空字段、非数字常量和嵌套取值。
 * @param body - 标准次数表达式的数字文本或有限 JSON 表达式。
 * @returns 可复用字段类型校验的次数映射。
 * @throws 表达式不完整、常量越限或引用不是公开业务字段时拒绝发布。
 */
export function bpmnCardinalityBinding(body: string): ValueBinding {
  const expression = JSON.parse(body);
  const reference = (value: any): ValueReference => {
    if (typeof value?.path !== 'string') throw new Error('多实例次数必须引用业务字段');
    const parts = value.path.split('.');
    if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('多实例次数引用字段不合法');
    if (parts[0] === 'input' && parts.length === 2) return { type: 'input', field: parts[1] };
    if (parts[0] === 'outputs' && parts.length === 3) return { type: 'node', nodeId: parts[1], field: parts[2] };
    throw new Error('多实例次数只能引用流程输入或节点结果');
  };
  let count = expression;
  if (expression && typeof expression === 'object') {
    if ('path' in expression) return reference(expression);
    if (expression.op === 'coalesce') {
      if (!Array.isArray(expression.values) || !expression.values.length || expression.values.length > 8) throw new Error('多实例次数需要一至八个优先来源');
      return { type: 'first', sources: expression.values.map(reference) };
    }
    count = expression.value;
  }
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error('多实例数量必须为零至一千的整数');
  return { type: 'literal', value: count };
}

export type BpmnExpression =
  | { value: string | number | boolean | null }
  | { path: string }
  | { op: 'not'; value: BpmnExpression }
  | { op: 'and' | 'or'; values: BpmnExpression[] }
  | { op: 'coalesce'; values: BpmnExpression[] }
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; left: BpmnExpression; right: BpmnExpression };

/**
 * 解释 BPMN FormalExpression 中声明的有限 JSON 表达式，不执行动态 JavaScript。
 * @param expression - 有常量、字段路径或明确运算符的表达式。
 * @param context - 当前活动公开的流程变量和实例输入。
 * @param depth - 限制递归深度的内部计数。
 * @returns 按类型比较得到的标量、数组或对象值。
 * @throws 表达式类型、路径、比较类型或递归深度不合法时拒绝求值。
 */
export function evaluateBpmnExpression(expression: BpmnExpression, context: Record<string, unknown>, depth = 0): unknown {
  if (!expression || typeof expression !== 'object' || depth > 16) throw new Error('BPMN 表达式结构或深度无效');
  if (!('op' in expression)) {
    if ('value' in expression) {
      if (expression.value === null || typeof expression.value === 'string' || typeof expression.value === 'boolean') return expression.value;
      if (typeof expression.value === 'number' && Number.isFinite(expression.value)) return expression.value;
      throw new Error('BPMN 表达式常量必须是有限数值、文本、布尔值或空值');
    }
    if (!('path' in expression) || typeof expression.path !== 'string' || !/^(input|outputs|variables|content)(\.[A-Za-z0-9_-]+)*$/.test(expression.path)) throw new Error('BPMN 表达式只能读取已声明的上下文路径');
    let value: unknown = context;
    for (const key of expression.path.split('.')) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('BPMN 表达式路径不允许访问原型');
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }
  if (expression.op === 'not') return !Boolean(evaluateBpmnExpression(expression.value, context, depth + 1));
  if (expression.op === 'coalesce') {
    if (!Array.isArray(expression.values) || !expression.values.length || expression.values.length > 8)
      throw new Error('优先取值需要 1 至 8 个表达式');
    for (const candidate of expression.values) {
      const value = evaluateBpmnExpression(candidate, context, depth + 1);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }
  if (expression.op === 'and' || expression.op === 'or') {
    if (!Array.isArray(expression.values) || !expression.values.length || expression.values.length > 32) throw new Error('BPMN 组合条件必须包含 1 至 32 个子条件');
    const values = expression.values.map((value) => Boolean(evaluateBpmnExpression(value, context, depth + 1)));
    if (expression.op === 'and') return values.every(Boolean);
    return values.some(Boolean);
  }
  if (!('left' in expression) || !('right' in expression)) throw new Error('BPMN 比较表达式缺少操作数');
  const left = evaluateBpmnExpression(expression.left, context, depth + 1), right = evaluateBpmnExpression(expression.right, context, depth + 1);
  if (expression.op === 'eq') return left === right;
  if (expression.op === 'ne') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) throw new Error('BPMN 顺序比较只接受有限数值');
  if (expression.op === 'lt') return left < right;
  if (expression.op === 'lte') return left <= right;
  if (expression.op === 'gt') return left > right;
  if (expression.op === 'gte') return left >= right;
  throw new Error('未知 BPMN 表达式运算符');
}
