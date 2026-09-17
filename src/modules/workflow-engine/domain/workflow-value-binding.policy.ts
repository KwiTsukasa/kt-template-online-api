import {
  rejectDefinition,
  requireDefinition,
} from '@/common/automation/validation';

import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import { RUN_STATUS } from '@/common/automation/constants/run-status';
import { definitionRecord } from '@/common/automation/definition.types';
import type { ValueBinding, ValueReference } from '../contract/workflow.types';
import type { WorkflowNodeProgress } from '../contract/workflow-activity.types';
import {
  BPMN_MODEL_PATTERN,
  WORKFLOW_BINDING_FIELD_PATTERN,
} from '../constants/bpmn';

const reserved = FORBIDDEN_OBJECT_KEYS;

/**
 * 限制变量字段与节点引用身份，防止路径和原型名称进入持久映射。
 * @param value - 由流程映射提交的标识。
 * @param node - 是否按标准节点身份校验，节点允许标准规定的点号及 Unicode 字符。
 * @returns 符合字段映射契约的标识。
 * @throws 身份格式非法时拒绝保存。
 */
function identity(value: unknown, node = false): string {
  let pattern = WORKFLOW_BINDING_FIELD_PATTERN;
  if (node) pattern = BPMN_MODEL_PATTERN.id;
  requireDefinition(
    typeof value === 'string' && pattern.test(value) && !reserved.has(value),
    '字段映射标识不合法',
  );
  return value;
}

/**
 * 限制字段映射、循环序号及有界候选来源，禁止嵌套取值链或执行表达式代码。
 * @param input - 编辑器提交的映射字典。
 * @returns 经过类型检查的变量绑定。
 * @throws 绑定类型、字段标识或常量值非法时拒绝保存。
 */
export function normalizeBindings(
  input: unknown,
): Record<string, ValueBinding> {
  const source = definitionRecord(input);
  requireDefinition(Object.keys(source).length <= 64, '变量映射最多 64 项');
  const result: Record<string, ValueBinding> = {};
  for (const [field, raw] of Object.entries(source)) {
    identity(field);
    const binding = definitionRecord(raw);
    if (binding.type === 'literal') {
      const value = binding.value;
      if (
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 16384) ||
        (typeof value === 'number' && Number.isFinite(value))
      )
        result[field] = { type: 'literal', value };
      else rejectDefinition('映射常量必须是有界标量');
    } else if (binding.type === 'iteration')
      result[field] = { type: 'iteration' };
    else if (binding.type === 'first') {
      requireDefinition(
        Array.isArray(binding.sources) &&
          binding.sources.length >= 1 &&
          binding.sources.length <= 8,
        '优先取值需要 1 至 8 个字段来源',
      );
      const sources = binding.sources.map((rawSource) => {
        const candidate = definitionRecord(rawSource);
        if (candidate.type === 'input')
          return { type: 'input' as const, field: identity(candidate.field) };
        if (candidate.type === 'node')
          return {
            type: 'node' as const,
            nodeId: identity(candidate.nodeId, true),
            field: identity(candidate.field),
          };
        rejectDefinition('优先取值只能引用流程输入或节点输出');
      });
      result[field] = { type: 'first', sources };
    } else if (binding.type === 'input')
      result[field] = { type: 'input', field: identity(binding.field) };
    else if (binding.type === 'node')
      result[field] = {
        type: 'node',
        nodeId: identity(binding.nodeId, true),
        field: identity(binding.field),
      };
    else rejectDefinition('变量映射类型不支持');
  }
  return result;
}

/**
 * 从已持久字段或当前活动的循环序号建立参数，优先取值跳过未产生的结果并保留零和假。
 * @param bindings - 当前节点或流程输出的字段映射。
 * @param input - 已校验的流程输入。
 * @param progress - 当前持久节点输出。
 * @param iterationIndex - BPMN 当前活动从零开始的循环索引，非循环活动不提供。
 * @returns 不包含原型或未声明动态执行内容的参数对象。
 * @throws 直接引用尚未成功的节点，或在非循环活动读取序号时拒绝执行。
 */
export function bindWorkflowValues(
  bindings: Record<string, ValueBinding>,
  input: Record<string, unknown>,
  progress: ReadonlyMap<string, WorkflowNodeProgress>,
  iterationIndex?: number,
): Record<string, unknown> {
  const sourceValues = (
    source: ValueReference,
  ): Record<string, unknown> | undefined => {
    if (source.type === 'input') return input;
    const node = progress.get(source.nodeId);
    if (node?.status === RUN_STATUS.succeeded) return node.output;
    return undefined;
  };
  const result: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.type === 'literal') {
      result[key] = binding.value;
      continue;
    }
    if (binding.type === 'iteration') {
      requireDefinition(
        Number.isSafeInteger(iterationIndex) && iterationIndex >= 0,
        '当前活动没有可读取的循环序号',
      );
      result[key] = iterationIndex + 1;
      continue;
    }
    if (binding.type === 'first') {
      for (const source of binding.sources) {
        const values = sourceValues(source);
        if (
          !values ||
          !Object.hasOwn(values, source.field) ||
          values[source.field] === null ||
          values[source.field] === undefined
        )
          continue;
        result[key] = values[source.field];
        break;
      }
      continue;
    }
    const values = sourceValues(binding);
    requireDefinition(values, '映射来源节点尚未成功');
    if (Object.hasOwn(values, binding.field))
      result[key] = values[binding.field];
  }
  return result;
}
