import type { FormControl } from '../contract/form.types';

export const FORM_SCHEMA_VERSION = 1;
export const FORM_LIMIT = {
  columns: 3,
  placeholderLength: 160,
  helpLength: 512,
} as const;
export const FORM_CONTROLS = {
  boolean: ['Switch'],
  options: ['Select', 'RadioGroup'],
  date: ['DatePicker'],
  numeric: ['InputNumber'],
  text: ['Input', 'Textarea'],
} as const satisfies Record<string, readonly FormControl[]>;
export const FORM_ERROR = {
  version: '表单结构版本不支持',
  columns: '布局仅支持 1 至 3 列',
  fieldCount: '每个数据字段必须有且只有一项展示定义',
  fieldReference: '表单布局引用了不存在或重复的字段',
  span: '字段跨列数超出布局',
  help: '字段提示或帮助文字不合法',
} as const;
