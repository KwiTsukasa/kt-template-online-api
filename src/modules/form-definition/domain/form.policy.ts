import {
  normalizeDataSchema,
  validateDataValues,
  validateFieldValue,
} from '@/common/automation/data-schema';
import { definitionRecord } from '@/common/automation/definition.types';
import {
  definitionInteger,
  requireDefinition,
} from '@/common/automation/validation';
import type { DataField } from '@/common/automation/data-schema';
import {
  FORM_CONTROLS,
  FORM_ERROR,
  FORM_LIMIT,
  FORM_SCHEMA_VERSION,
} from '../constants/form';
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
  requireDefinition(
    source.schemaVersion === FORM_SCHEMA_VERSION,
    FORM_ERROR.version,
  );
  const dataSchema = normalizeDataSchema(source.dataSchema);
  const fieldsByKey = new Map(
    dataSchema.fields.map((field) => [field.key, field]),
  );
  const ui = definitionRecord(source.uiSchema);
  const columns = definitionInteger(
    ui.columns,
    1,
    FORM_LIMIT.columns,
    FORM_ERROR.columns,
  ) as FormDefinition['uiSchema']['columns'];
  requireDefinition(
    Array.isArray(ui.fields) && ui.fields.length === dataSchema.fields.length,
    FORM_ERROR.fieldCount,
  );
  const used = new Set<string>();
  const fields = ui.fields.map((raw) => {
    const item = definitionRecord(raw);
    requireDefinition(typeof item.key === 'string', FORM_ERROR.fieldReference);
    const field = fieldsByKey.get(item.key);
    requireDefinition(field && !used.has(field.key), FORM_ERROR.fieldReference);
    used.add(field.key);
    requireDefinition(
      allowedFormControls(field).includes(item.component as FormControl),
      `${field.label}：控件不支持该字段类型`,
    );
    const span = definitionInteger(item.span, 1, columns, FORM_ERROR.span);
    requireDefinition(
      typeof item.placeholder === 'string' &&
        item.placeholder.length <= FORM_LIMIT.placeholderLength &&
        typeof item.help === 'string' &&
        item.help.length <= FORM_LIMIT.helpLength,
      FORM_ERROR.help,
    );
    const layout: FormFieldLayout = {
      key: field.key,
      component: item.component as FormControl,
      span,
      placeholder: item.placeholder,
      help: item.help,
    };
    if (item.requiredWhen !== undefined) {
      const condition = definitionRecord(item.requiredWhen);
      requireDefinition(
        typeof condition.field === 'string',
        `${field.label}：条件必填必须引用其他已声明字段`,
      );
      const dependency = fieldsByKey.get(condition.field);
      requireDefinition(
        dependency && dependency.key !== field.key,
        `${field.label}：条件必填必须引用其他已声明字段`,
      );
      validateFieldValue({ ...dependency, required: false }, condition.equals);
      layout.requiredWhen = {
        field: dependency.key,
        equals: condition.equals as FormFieldLayout['requiredWhen']['equals'],
      };
    }
    return layout;
  });
  return {
    schemaVersion: FORM_SCHEMA_VERSION,
    dataSchema,
    uiSchema: { columns, fields },
  };
}

/**
 * 按字段的选择、日期和数值约束取得合法控件，保持类型优先级固定。
 * @param field - 已通过数据契约校验的字段。
 * @returns 该字段可使用的控件集合。
 */
function allowedFormControls(field: DataField): readonly FormControl[] {
  if (field.type === 'boolean') return FORM_CONTROLS.boolean;
  if (field.options) return FORM_CONTROLS.options;
  if (field.format) return FORM_CONTROLS.date;
  if (field.type === 'number' || field.type === 'integer')
    return FORM_CONTROLS.numeric;
  return FORM_CONTROLS.text;
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
