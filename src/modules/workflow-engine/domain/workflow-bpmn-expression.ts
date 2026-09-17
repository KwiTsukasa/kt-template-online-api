import { bpmnPath, bpmnPathParts } from './workflow-bpmn-path';
import {
  rejectDefinition,
  requireDefinition,
} from '@/common/automation/validation';

import { WORKFLOW_BPMN_LIMITS } from '../constants/bpmn';
import type { ValueBinding, ValueReference } from '../contract/workflow.types';
import { requireBpmnInstanceCount } from './workflow-bpmn-limits';

/**
 * 校验多实例次数并还原业务字段引用，拒绝空字段、非数字常量和嵌套取值。
 * @param body - 标准次数表达式的数字文本或有限 JSON 表达式。
 * @returns 可复用字段类型校验的次数映射。
 * @throws 表达式不完整、常量越限或引用不是公开业务字段时拒绝发布。
 */
export function bpmnCardinalityBinding(body: string): ValueBinding {
  const expression = JSON.parse(body);
  const reference = (value: any): ValueReference => {
    requireDefinition(
      typeof value?.path === 'string',
      '多实例次数必须引用业务字段',
    );
    const parts = bpmnPathParts(value.path);
    if (parts[0] === 'input' && parts.length === 2)
      return { type: 'input', field: parts[1] };
    if (parts[0] === 'outputs' && parts.length === 3)
      return { type: 'node', nodeId: parts[1], field: parts[2] };
    rejectDefinition('多实例次数只能引用流程输入或节点结果');
  };
  if (!expression || typeof expression !== 'object')
    return { type: 'literal', value: requireBpmnInstanceCount(expression) };
  if ('path' in expression) return reference(expression);
  if (expression.op !== 'coalesce')
    return {
      type: 'literal',
      value: requireBpmnInstanceCount(expression.value),
    };
  requireDefinition(
    Array.isArray(expression.values) &&
      expression.values.length > 0 &&
      expression.values.length <= WORKFLOW_BPMN_LIMITS.prioritySources,
    '多实例次数需要一至八个优先来源',
  );
  return { type: 'first', sources: expression.values.map(reference) };
}

export type BpmnExpression =
  | { value: string | number | boolean | null }
  | { path: string }
  | { op: 'not'; value: BpmnExpression }
  | { op: 'and' | 'or'; values: BpmnExpression[] }
  | { op: 'coalesce'; values: BpmnExpression[] }
  | { op: 'sum'; values: BpmnExpression[] }
  | {
      op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
      left: BpmnExpression;
      right: BpmnExpression;
    };

/**
 * 在没有运行数据时检查条件树与已知入口类型，保留业务字段的动态求值但拒绝未知运算。
 * @param expression - 发布模型内的有限表达式。
 * @param paths - 当前复杂网关公开的入口计数及阶段路径类型。
 * @param depth - 当前递归深度，用于限制恶意或意外嵌套。
 * @returns 可静态判断的标量类型，业务字段返回未知类型。
 * @throws 表达式结构、字段、操作数类型或深度不合法时拒绝发布。
 */
export function bpmnConditionType(
  expression: BpmnExpression,
  paths: Record<string, string>,
  depth = 0,
): string {
  requireDefinition(
    expression &&
      typeof expression === 'object' &&
      !Array.isArray(expression) &&
      depth <= WORKFLOW_BPMN_LIMITS.expressionDepth,
    'BPMN 条件结构或深度无效',
  );
  if (!('op' in expression)) return bpmnLeafType(expression, paths);
  if (expression.op === 'not') {
    bpmnConditionType(expression.value, paths, depth + 1);
    return 'boolean';
  }
  if (
    ['and', 'or', 'sum', 'coalesce'].includes(expression.op) &&
    'values' in expression
  ) {
    requireDefinition(
      Array.isArray(expression.values) &&
        expression.values.length &&
        expression.values.length <= WORKFLOW_BPMN_LIMITS.expressionOperands,
      'BPMN 条件操作数需要 1 至 32 项',
    );
    const types = expression.values.map((value) =>
      bpmnConditionType(value, paths, depth + 1),
    );
    if (expression.op === 'sum') {
      requireDefinition(
        types.every((type) => type === 'number' || type === 'unknown'),
        'BPMN 求和只接受数值字段',
      );
      return 'number';
    }
    if (expression.op === 'coalesce') {
      requireDefinition(
        expression.values.length <= WORKFLOW_BPMN_LIMITS.prioritySources,
        '优先取值不能超过 8 项',
      );
      return 'unknown';
    }
    return 'boolean';
  }
  requireDefinition(
    ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(expression.op) &&
      'left' in expression &&
      'right' in expression,
    'BPMN 条件运算符或操作数无效',
  );
  const types = [expression.left, expression.right].map((value) =>
    bpmnConditionType(value, paths, depth + 1),
  );
  requireDefinition(
    ['eq', 'ne'].includes(expression.op) ||
      !types.some((type) => !['number', 'unknown'].includes(type)),
    'BPMN 顺序比较只接受数值字段',
  );
  return 'boolean';
}

/**
 * 仅对公开字段、有限数值和声明的操作符求值，阻止动态代码与原型访问。
 * @param expression - 有常量、字段路径或明确运算符的表达式。
 * @param context - 当前活动公开的流程变量和实例输入。
 * @param depth - 限制递归深度的内部计数。
 * @returns 按类型比较得到的标量、数组或对象值。
 * @throws 表达式类型、路径、比较类型或递归深度不合法时拒绝求值。
 */
export function evaluateBpmnExpression(
  expression: BpmnExpression,
  context: Record<string, unknown>,
  depth = 0,
): unknown {
  requireDefinition(
    expression &&
      typeof expression === 'object' &&
      depth <= WORKFLOW_BPMN_LIMITS.expressionDepth,
    'BPMN 表达式结构或深度无效',
  );
  if (!('op' in expression)) return evaluateBpmnLeaf(expression, context);
  if (expression.op === 'not')
    return !Boolean(
      evaluateBpmnExpression(expression.value, context, depth + 1),
    );
  if (expression.op === 'sum') {
    requireDefinition(
      Array.isArray(expression.values) &&
        expression.values.length &&
        expression.values.length <= WORKFLOW_BPMN_LIMITS.expressionOperands,
      'BPMN 求和必须包含 1 至 32 个操作数',
    );
    let total = 0;
    for (const operand of expression.values) {
      const value = evaluateBpmnExpression(operand, context, depth + 1);
      requireDefinition(
        typeof value === 'number' && Number.isFinite(value),
        'BPMN 求和只接受有限数值',
      );
      total += value;
      requireDefinition(
        Number.isFinite(total),
        'BPMN 求和结果超出有限数值范围',
      );
    }
    return total;
  }
  if (expression.op === 'coalesce') {
    requireDefinition(
      Array.isArray(expression.values) &&
        expression.values.length &&
        expression.values.length <= WORKFLOW_BPMN_LIMITS.prioritySources,
      '优先取值需要 1 至 8 个表达式',
    );
    for (const candidate of expression.values) {
      const value = evaluateBpmnExpression(candidate, context, depth + 1);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }
  if (expression.op === 'and' || expression.op === 'or') {
    requireDefinition(
      Array.isArray(expression.values) &&
        expression.values.length &&
        expression.values.length <= WORKFLOW_BPMN_LIMITS.expressionOperands,
      'BPMN 组合条件必须包含 1 至 32 个子条件',
    );
    const values = expression.values.map((value) =>
      Boolean(evaluateBpmnExpression(value, context, depth + 1)),
    );
    if (expression.op === 'and') return values.every(Boolean);
    return values.some(Boolean);
  }
  requireDefinition(
    'left' in expression && 'right' in expression,
    'BPMN 比较表达式缺少操作数',
  );
  const left = evaluateBpmnExpression(expression.left, context, depth + 1),
    right = evaluateBpmnExpression(expression.right, context, depth + 1);
  if (expression.op === 'eq') return left === right;
  if (expression.op === 'ne') return left !== right;
  requireDefinition(
    typeof left === 'number' &&
      typeof right === 'number' &&
      Number.isFinite(left) &&
      Number.isFinite(right),
    'BPMN 顺序比较只接受有限数值',
  );
  if (expression.op === 'lt') return left < right;
  if (expression.op === 'lte') return left <= right;
  if (expression.op === 'gt') return left > right;
  if (expression.op === 'gte') return left >= right;
  rejectDefinition('未知 BPMN 表达式运算符');
}

/**
 * 核验表达式叶子的常量与字段路径，路径逐段读取且拒绝原型属性，不递归到运算节点。
 * @param expression - 已排除运算符的常量或字段引用。
 * @param context - 本次活动的公开上下文。
 * @returns 常量或已存在的字段值，未找到字段时为空值。
 * @throws 常量不是有限标量或字段路径不合法时拒绝求值。
 */
function evaluateBpmnLeaf(
  expression: Exclude<BpmnExpression, { op: string }>,
  context: Record<string, unknown>,
): unknown {
  if ('value' in expression) {
    if (
      expression.value === null ||
      typeof expression.value === 'string' ||
      typeof expression.value === 'boolean'
    )
      return expression.value;
    if (
      typeof expression.value === 'number' &&
      Number.isFinite(expression.value)
    )
      return expression.value;
    rejectDefinition('BPMN 表达式常量必须是有限数值、文本、布尔值或空值');
  }
  requireDefinition(
    'path' in expression && typeof expression.path === 'string',
    'BPMN 表达式只能读取已声明的上下文路径',
  );
  const parts = bpmnPathParts(expression.path);
  let value: unknown = context;
  for (const key of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * 推断常量及字段引用的类型，复杂网关计数和阶段字段必须来自当前网关声明。
 * @param expression - 已排除运算符的表达式叶子。
 * @param paths - 当前网关允许的字段及其类型。
 * @returns 常量类型、已声明字段类型，或业务字段的未知类型。
 * @throws 非法叶子或不存在的网关字段不能通过发布校验。
 */
function bpmnLeafType(
  expression: Exclude<BpmnExpression, { op: string }>,
  paths: Record<string, string>,
): string {
  const value = evaluateBpmnLeaf(expression, {});
  if (!('path' in expression)) return typeof value;
  const parts = bpmnPathParts(expression.path);
  if (
    parts[0] !== 'content' ||
    (parts[1] !== 'activationCount' && parts[1] !== 'waitingForStart')
  )
    return 'unknown';
  const path = bpmnPath(parts);
  requireDefinition(
    Object.hasOwn(paths, path),
    '复杂网关条件引用了不存在的入口或阶段字段',
  );
  return paths[path];
}
