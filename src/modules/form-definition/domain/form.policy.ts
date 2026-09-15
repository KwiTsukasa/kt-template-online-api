import { normalizeDataSchema } from '@/common/automation/data-schema';
import { definitionRecord } from '@/common/automation/definition.types';
import type { FormControl, FormDefinition } from '../contract/form.types';

/**
 * 校验表单字段与展示定义的一一对应关系，只开放 Vben 已注册且类型相容的控件。
 * @param input - 数据结构和控件布局定义。
 * @returns 可直接转换为 Vben 表单结构的规范定义。
 * @throws 未知控件、字段缺失、重复布局或数据类型不相容时拒绝保存。
 */
export function normalizeFormDefinition(input: unknown): FormDefinition {
  const source = definitionRecord(input);
  if (source.schemaVersion !== 1) throw new Error('表单结构版本不支持');
  const dataSchema = normalizeDataSchema(source.dataSchema);
  const ui = definitionRecord(source.uiSchema);
  if (ui.columns !== 1 && ui.columns !== 2 && ui.columns !== 3) throw new Error('布局仅支持 1 至 3 列');
  const columns = ui.columns;
  if (!Array.isArray(ui.fields) || ui.fields.length !== dataSchema.fields.length) throw new Error('每个数据字段必须有且只有一项展示定义');
  const used = new Set<string>();
  const fields = ui.fields.map((raw) => {
    const item = definitionRecord(raw);
    const field = dataSchema.fields.find((candidate) => candidate.key === item.key);
    if (!field || used.has(field.key)) throw new Error('表单布局引用了不存在或重复的字段');
    used.add(field.key);
    const allowed: FormControl[] = [];
    if (field.type === 'boolean') allowed.push('Switch');
    else if (field.options) allowed.push('Select', 'RadioGroup');
    else if (field.format) allowed.push('DatePicker');
    else if (field.type === 'number' || field.type === 'integer') allowed.push('InputNumber');
    else allowed.push('Input', 'Textarea');
    if (!allowed.includes(item.component as FormControl)) throw new Error(`${field.label}：控件不支持该字段类型`);
    if (!Number.isInteger(item.span) || Number(item.span) < 1 || Number(item.span) > columns) throw new Error('字段跨列数超出布局');
    if (typeof item.placeholder !== 'string' || item.placeholder.length > 160 || typeof item.help !== 'string' || item.help.length > 512) throw new Error('字段提示或帮助文字不合法');
    return { key: field.key, component: item.component as FormControl, span: Number(item.span), placeholder: item.placeholder, help: item.help };
  });
  return { schemaVersion: 1, dataSchema, uiSchema: { columns, fields } };
}
