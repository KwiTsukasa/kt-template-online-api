import { definitionRecord } from './definition.types';

export type DataScalar = boolean | number | string;
export type DataField = {
  key: string;
  label: string;
  type: 'boolean' | 'integer' | 'number' | 'string';
  required: boolean;
  min?: number;
  max?: number;
  format?: 'date' | 'date-time';
  options?: { label: string; value: DataScalar }[];
};
export type DataSchema = { fields: DataField[] };

const reservedFields = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * 将字段契约限制为当前前后端都能验证的有界标量，拒绝未实现的类型与控件约束。
 * @param input - 字段定义集合。
 * @returns 可序列化且字段标识唯一的数据契约。
 * @throws 字段重复、类型未知或约束互相矛盾时拒绝保存。
 */
export function normalizeDataSchema(input: unknown): DataSchema {
  const source = definitionRecord(input);
  if (!Array.isArray(source.fields) || source.fields.length > 64) throw new Error('字段数量必须在 0 至 64 之间');
  const keys = new Set<string>();
  const fields: DataField[] = source.fields.map((raw) => {
    const field = definitionRecord(raw);
    if (typeof field.key !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(field.key) || reservedFields.has(field.key) || keys.has(field.key)) throw new Error('字段标识不合法或重复');
    keys.add(field.key);
    if (typeof field.label !== 'string' || !field.label.trim() || field.label.length > 80) throw new Error('字段标题需要 1 至 80 个字符');
    if (field.type !== 'string' && field.type !== 'number' && field.type !== 'integer' && field.type !== 'boolean') throw new Error('字段类型尚不支持');
    if (typeof field.required !== 'boolean') throw new Error('必须明确字段是否必填');
    const result: DataField = { key: field.key, label: field.label.trim(), type: field.type, required: field.required };
    for (const bound of ['min', 'max'] as const) {
      if (field[bound] === undefined) continue;
      if (typeof field[bound] !== 'number' || !Number.isFinite(field[bound]) || field.type === 'boolean') throw new Error('字段范围必须是有限数字，布尔字段不支持范围');
      if (field.type === 'string' && (!Number.isInteger(field[bound]) || field[bound] < 0 || field[bound] > 16384)) throw new Error('文本长度范围必须是 0 至 16384 的整数');
      result[bound] = field[bound];
    }
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) throw new Error('字段最小值不能大于最大值');
    if (field.format !== undefined) {
      if (field.type !== 'string' || (field.format !== 'date' && field.format !== 'date-time')) throw new Error('日期格式只支持文本字段');
      result.format = field.format;
    }
    if (field.options !== undefined) {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100 || result.format) throw new Error('枚举选项需要 1 至 100 项且不能和日期格式混用');
      const values = new Set<DataScalar>();
      result.options = field.options.map((item) => {
        const option = definitionRecord(item);
        if (typeof option.label !== 'string' || !option.label.trim() || option.label.length > 80) throw new Error('选项标题不合法');
        validateFieldValue({ ...result, options: undefined }, option.value);
        const value = option.value as DataScalar;
        if (values.has(value)) throw new Error('枚举选项值不能重复');
        values.add(value);
        return { label: option.label.trim(), value };
      });
    }
    return result;
  });
  return { fields };
}

/**
 * 对单个标量执行严格类型、日期、枚举和范围检查，不进行隐式类型转换。
 * @param field - 已规范化的字段定义。
 * @param value - 本次填写或系统传入的值。
 * @throws 值不满足字段定义时返回包含字段名称的校验错误。
 */
export function validateFieldValue(field: DataField, value: unknown): void {
  let valid = false;
  if (field.type === 'string') valid = typeof value === 'string' && value.length <= 16384;
  if (field.type === 'boolean') valid = typeof value === 'boolean';
  if (field.type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'integer') valid = typeof value === 'number' && Number.isSafeInteger(value);
  if (!valid) throw new Error(`${field.label}：值类型不正确`);
  if (field.required && typeof value === 'string' && !value.trim()) throw new Error(`${field.label}：不能为空`);
  let measure: number | undefined;
  if (typeof value === 'string') measure = value.length;
  if (typeof value === 'number') measure = value;
  if (measure !== undefined && field.min !== undefined && measure < field.min) throw new Error(`${field.label}：小于允许的最小值`);
  if (measure !== undefined && field.max !== undefined && measure > field.max) throw new Error(`${field.label}：超过允许的最大值`);
  if (field.options && !field.options.some((option) => option.value === value)) throw new Error(`${field.label}：不属于允许的选项`);
  if (field.format === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${field.label}：日期不合法`);
  }
  if (field.format === 'date-time') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field.label}：时间必须包含明确时区`);
  }
}

/**
 * 根据固定数据契约校验实例值，拒绝额外字段和服务端未授权填写的字段。
 * @param schema - 已发布的数据结构。
 * @param input - 本次提交的字段值。
 * @param writableFields - 消费方裁决的可写字段；省略时允许该结构内的所有字段。
 * @returns 与原对象分离的已验证字段值。
 * @throws 未声明、越权、缺失必填或值非法时拒绝整个提交。
 */
export function validateDataValues(schema: DataSchema, input: unknown, writableFields?: readonly string[]): Record<string, DataScalar> {
  const source = definitionRecord(input);
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const result: Record<string, DataScalar> = {};
  for (const [key, value] of Object.entries(source)) {
    const field = fields.get(key);
    if (!field || reservedFields.has(key)) throw new Error(`未声明字段：${key}`);
    if (writableFields && !writableFields.includes(key)) throw new Error(`无权填写字段：${key}`);
    validateFieldValue(field, value);
    result[key] = value as DataScalar;
  }
  for (const field of schema.fields) {
    if (field.required && !Object.prototype.hasOwnProperty.call(result, field.key)) throw new Error(`${field.label}：必填字段缺失`);
  }
  return result;
}
