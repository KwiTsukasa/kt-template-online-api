import {
  rejectDefinition,
  requireDefinition,
} from '@/common/automation/validation';

import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import {
  definitionRecord,
  publishedReference,
} from '@/common/automation/definition.types';
import {
  validateFieldValue,
  type DataField,
  type DataScalar,
  type DataSchema,
} from '@/common/automation/data-schema';
import type { TriggerOccurrenceView } from '@/modules/trigger-engine/contract/trigger-runtime.port';
import type {
  ScheduleBinding,
  ScheduleDefinition,
} from '../contract/schedule.types';

const metadataFields: DataField[] = [
  { key: 'id', label: '发生记录 ID', type: 'string', required: true },
  { key: 'registrationId', label: '注册 ID', type: 'string', required: true },
  {
    key: 'occurredAt',
    label: '发生时间',
    type: 'string',
    required: true,
    format: 'date-time',
  },
];

/**
 * 将计划映射限制为常量、已声明事件字段和发生身份，不接收代码或模板表达式。
 * @param input - 编辑器保存的字段映射。
 * @returns 字段身份合法且来源明确的映射。
 * @throws 字段身份、常量类型或来源不受支持时拒绝保存。
 */
export function normalizeScheduleBindings(
  input: unknown,
): Record<string, ScheduleBinding> {
  const source = definitionRecord(input);
  requireDefinition(
    Object.keys(source).length <= 64,
    '计划映射最多支持 64 个字段',
  );
  const result: Record<string, ScheduleBinding> = {};
  for (const [key, raw] of Object.entries(source)) {
    requireDefinition(
      /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) &&
        !FORBIDDEN_OBJECT_KEYS.has(key),
      '计划映射字段标识不合法',
    );
    const binding = definitionRecord(raw);
    if (binding.source === 'literal') {
      requireDefinition(
        typeof binding.value === 'string' ||
          typeof binding.value === 'number' ||
          typeof binding.value === 'boolean',
        '计划常量必须是标量',
      );
      requireDefinition(
        typeof binding.value !== 'number' || Number.isFinite(binding.value),
        '计划常量不能是无限数字',
      );
      requireDefinition(
        typeof binding.value !== 'string' || binding.value.length <= 16384,
        '计划常量超过文本长度限制',
      );
      result[key] = { source: 'literal', value: binding.value };
      continue;
    }
    if (
      binding.source === 'event' &&
      typeof binding.field === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(binding.field)
    ) {
      result[key] = { source: 'event', field: binding.field };
      continue;
    }
    if (
      binding.source === 'occurrence' &&
      (binding.field === 'id' ||
        binding.field === 'registrationId' ||
        binding.field === 'occurredAt')
    ) {
      result[key] = { source: 'occurrence', field: binding.field };
      continue;
    }
    rejectDefinition('计划映射来源不支持');
  }
  return result;
}

/**
 * 保存计划自身的引用和准入配置，草稿允许暂未选择目标，发布时由应用层核验依赖。
 * @param input - 计划编辑页提交的草稿。
 * @returns 与任务、规则和流程内部定义分离的计划。
 * @throws 结构版本、重叠策略或执行期限非法时拒绝保存。
 */
export function normalizeScheduleDefinition(
  input: unknown,
): ScheduleDefinition {
  const source = definitionRecord(input);
  requireDefinition(source.schemaVersion === 1, '计划结构版本不支持');
  requireDefinition(
    source.overlap === 'allow' || source.overlap === 'skip',
    '计划重叠策略不支持',
  );
  requireDefinition(
    Number.isSafeInteger(source.taskDeadlineMs) &&
      Number(source.taskDeadlineMs) >= 1000 &&
      Number(source.taskDeadlineMs) <= 86400000,
    '原子任务总期限必须在 1 秒至 24 小时之间',
  );
  let triggerRef: ScheduleDefinition['triggerRef'] = null;
  let target: ScheduleDefinition['target'] = null;
  let admission: ScheduleDefinition['admission'] = null;
  if (source.triggerRef !== null)
    triggerRef = publishedReference(source.triggerRef);
  if (source.target !== null) {
    const value = definitionRecord(source.target);
    requireDefinition(
      value.type === 'task' || value.type === 'workflow',
      '计划执行目标只能是任务或工作流',
    );
    target = {
      type: value.type,
      reference: publishedReference(value.reference),
    };
  }
  if (source.admission !== null) {
    const value = definitionRecord(source.admission);
    requireDefinition(
      value.expected === null ||
        typeof value.expected === 'boolean' ||
        typeof value.expected === 'string' ||
        typeof value.expected === 'number',
      '准入匹配值必须是规则结果标量',
    );
    requireDefinition(
      typeof value.expected !== 'number' || Number.isFinite(value.expected),
      '准入匹配值必须是有限数字',
    );
    admission = {
      ruleRef: publishedReference(value.ruleRef),
      facts: normalizeScheduleBindings(value.facts),
      expected: value.expected as DataScalar | null,
    };
  }
  return {
    schemaVersion: 1,
    triggerRef,
    target,
    admission,
    input: normalizeScheduleBindings(source.input),
    overlap: source.overlap,
    taskDeadlineMs: Number(source.taskDeadlineMs),
  };
}

/**
 * 发布时检查映射字段、必填来源及类型；执行时仍按目标完整契约验证实际值。
 * @param bindings - 计划选定的字段映射。
 * @param target - 固定目标的输入或规则事实结构。
 * @param event - 固定触发器能产生的载荷字段。
 * @throws 映射多余字段、必填缺失、来源缺失或类型不兼容时拒绝发布。
 */
export function validateScheduleBindings(
  bindings: Record<string, ScheduleBinding>,
  target: DataSchema,
  event: DataSchema,
): void {
  const targetFields = new Map(
    target.fields.map((field) => [field.key, field]),
  );
  const eventFields = new Map(event.fields.map((field) => [field.key, field]));
  const occurrenceFields = new Map(
    metadataFields.map((field) => [field.key, field]),
  );
  for (const [key, binding] of Object.entries(bindings)) {
    const destination = targetFields.get(key);
    requireDefinition(destination, `计划映射包含未声明字段：${key}`);
    if (binding.source === 'literal') {
      validateFieldValue(destination, binding.value);
      continue;
    }
    let sourceFields = occurrenceFields;
    if (binding.source === 'event') sourceFields = eventFields;
    const field = sourceFields.get(binding.field);
    requireDefinition(field, `${destination.label}：来源字段不存在`);
    const compatibleNumber =
      field.type === 'integer' && destination.type === 'number';
    requireDefinition(
      field.type === destination.type || compatibleNumber,
      `${destination.label}：来源类型不兼容`,
    );
    requireDefinition(
      !destination.required || field.required,
      `${destination.label}：必填输入不能来自可缺失字段`,
    );
    requireDefinition(
      !destination.format || destination.format === field.format,
      `${destination.label}：来源日期格式不兼容`,
    );
  }
  for (const field of target.fields) {
    requireDefinition(
      !field.required ||
        Object.prototype.hasOwnProperty.call(bindings, field.key),
      `${field.label}：必填映射缺失`,
    );
  }
}

/**
 * 从持久发生记录提取明确允许的字段，不递归访问对象或执行用户表达式。
 * @param bindings - 已发布计划中的字段映射。
 * @param occurrence - 当前已持久化的触发事件。
 * @returns 等待目标模块按自身契约再次校验的参数。
 */
export function bindScheduleValues(
  bindings: Record<string, ScheduleBinding>,
  occurrence: TriggerOccurrenceView,
): Record<string, DataScalar> {
  const result: Record<string, DataScalar> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.source === 'literal') {
      result[key] = binding.value;
      continue;
    }
    if (binding.source === 'event') {
      if (
        Object.prototype.hasOwnProperty.call(occurrence.payload, binding.field)
      )
        result[key] = occurrence.payload[binding.field];
      continue;
    }
    if (binding.field === 'occurredAt')
      result[key] = occurrence.occurredAt.toISOString();
    else result[key] = occurrence[binding.field];
  }
  return result;
}
