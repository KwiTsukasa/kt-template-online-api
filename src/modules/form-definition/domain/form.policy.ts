import {
  normalizeDataSchema,
  validateDataValues,
  validateFieldValue,
} from '@/common/automation/data-schema';
import { definitionRecord } from '@/common/automation/definition.types';
import type {
  FormControl,
  FormDefinition,
  FormFieldLayout,
} from '../contract/form.types';

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
  if (ui.columns !== 1 && ui.columns !== 2 && ui.columns !== 3)
    throw new Error('布局仅支持 1 至 3 列');
  const columns = ui.columns;
  if (
    !Array.isArray(ui.fields) ||
    ui.fields.length !== dataSchema.fields.length
  )
    throw new Error('每个数据字段必须有且只有一项展示定义');
  const used = new Set<string>();
  const fields = ui.fields.map((raw) => {
    const item = definitionRecord(raw);
    const field = dataSchema.fields.find(
      (candidate) => candidate.key === item.key,
    );
    if (!field || used.has(field.key))
      throw new Error('表单布局引用了不存在或重复的字段');
    used.add(field.key);
    const allowed: FormControl[] = [];
    if (field.type === 'boolean') allowed.push('Switch');
    else if (field.options) allowed.push('Select', 'RadioGroup');
    else if (field.format) allowed.push('DatePicker');
    else if (field.type === 'number' || field.type === 'integer')
      allowed.push('InputNumber');
    else allowed.push('Input', 'Textarea');
    if (!allowed.includes(item.component as FormControl))
      throw new Error(`${field.label}：控件不支持该字段类型`);
    if (
      !Number.isInteger(item.span) ||
      Number(item.span) < 1 ||
      Number(item.span) > columns
    )
      throw new Error('字段跨列数超出布局');
    if (
      typeof item.placeholder !== 'string' ||
      item.placeholder.length > 160 ||
      typeof item.help !== 'string' ||
      item.help.length > 512
    )
      throw new Error('字段提示或帮助文字不合法');
    const layout: FormFieldLayout = {
      key: field.key,
      component: item.component as FormControl,
      span: Number(item.span),
      placeholder: item.placeholder,
      help: item.help,
    };
    if (item.requiredWhen !== undefined) {
      const condition = definitionRecord(item.requiredWhen);
      const dependency = dataSchema.fields.find(
        (candidate) => candidate.key === condition.field,
      );
      if (!dependency || dependency.key === field.key)
        throw new Error(`${field.label}：条件必填必须引用其他已声明字段`);
      validateFieldValue({ ...dependency, required: false }, condition.equals);
      layout.requiredWhen = {
        field: dependency.key,
        equals: condition.equals as FormFieldLayout['requiredWhen']['equals'],
      };
    }
    return layout;
  });
  return { schemaVersion: 1, dataSchema, uiSchema: { columns, fields } };
}

/**
 * 根据同一份填写值计算条件必填，再执行严格字段和消费方授权校验。
 * @param definition - 已规范化或已发布的表单结构。
 * @param input - 本次完整表单填写值。
 * @param writableFields - 消费方允许写入的字段集合，省略时使用全部声明字段。
 * @returns 满足固定约束及跨字段必填条件的填写值。
 * @throws 缺少条件必填值、值类型错误或越权写入时拒绝提交。
 */
export function validateFormValues(
  definition: FormDefinition,
  input: unknown,
  writableFields?: readonly string[],
) {
  const values = definitionRecord(input);
  const layouts = new Map(
    definition.uiSchema.fields.map((layout) => [layout.key, layout]),
  );
  const fields = definition.dataSchema.fields.map((field) => {
    const condition = layouts.get(field.key)?.requiredWhen;
    let required = field.required;
    if (condition && values[condition.field] === condition.equals)
      required = true;
    return { ...field, required };
  });
  return validateDataValues({ fields }, values, writableFields);
}
