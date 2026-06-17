import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  type ColumnOptions,
  type ValueTransformer,
} from 'typeorm';

export const KT_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const KT_DATETIME_RULES = Symbol('KT_DATETIME_RULES');
const KT_DATETIME_INSTANCE_FORMATS = new WeakMap<Date, string>();
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;
const DATE_TIME_TEXT_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

type KtDateTimeRule = {
  format: string;
  sourceKey: string;
  targetKey: string;
};

type KtDateTimeRuleTarget = Record<PropertyKey, any> & {
  [KT_DATETIME_RULES]?: KtDateTimeRule[];
};

type KtDateTimeDecoratorOptions = string | ColumnOptions;

/**
 * 执行 KT 日期时间流程。
 * @param value - 待转换时间值；影响 padDateUnit 的返回值。
 */
const padDateUnit = (value: number) => `${value}`.padStart(2, '0');

export class KtDateTime extends Date {
  /**
   * 初始化 KtDateTime 实例。
   * @param value - 待转换值；执行 `value.getTime()` 对应的 公共基础设施步骤。
   * @param format - format 输入；驱动 `KT_DATETIME_INSTANCE_FORMATS.set()` 的 公共基础设施步骤。
   */
  constructor(value?: Date | number | string, format = KT_DATETIME_FORMAT) {
    super(value instanceof Date ? value.getTime() : (value ?? Date.now()));
    KT_DATETIME_INSTANCE_FORMATS.set(this, format);
  }

  /**
   * 序列化当前对象为 JSON 输出。
   * @returns KT 日期时间渲染后的图片、画布或文本。
   */
  toJSON(): string {
    return this.toString();
  }

  /**
   * 转换当前对象为字符串输出。
   * @returns KT 日期时间渲染后的图片、画布或文本。
   */
  toString(): string {
    return formatKtDateTime(this, getKtDateTimeFormat(this));
  }

  /**
   * 处理对象的原始值转换。
   * @param hint - hint 输入；影响 当前函数 的返回值。
   * @returns KT 日期时间产出的 number。
   */
  [Symbol.toPrimitive](hint: 'number'): number;
  /**
   * 处理对象的原始值转换。
   * @param hint - hint 输入；影响 当前函数 的返回值。
   * @returns KT 日期时间渲染后的图片、画布或文本。
   */
  [Symbol.toPrimitive](hint: 'default' | 'string'): string;
  /**
   * 处理对象的原始值转换。
   * @param hint - hint 输入；影响 当前函数 的返回值。
   * @returns KT 日期时间渲染后的图片、画布或文本。
   */
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === 'number' ? this.getTime() : this.toString();
  }
}

/**
 * 转换 KT 日期时间输入。
 * @param value - 待转换时间值；构造时间对象。
 * @param format - format 输入；生成规范化文本。
 * @returns KT 日期时间渲染后的图片、画布或文本。
 */
export const formatKtDateTime = (
  value: Date | number | string,
  format = KT_DATETIME_FORMAT,
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const tokens: Record<string, string> = {
    DD: padDateUnit(date.getDate()),
    HH: padDateUnit(date.getHours()),
    MM: padDateUnit(date.getMonth() + 1),
    YYYY: `${date.getFullYear()}`,
    mm: padDateUnit(date.getMinutes()),
    ss: padDateUnit(date.getSeconds()),
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokens[token]);
};

/**
 * 执行 KT 日期时间流程。
 * @param value - 待转换时间值；驱动 `KtDateTime()` 的 公共基础设施步骤。
 * @param format - format 输入；驱动 `KtDateTime()` 的 公共基础设施步骤。
 */
export const toKtDateTime = (
  value: Date | number | string,
  format = KT_DATETIME_FORMAT,
) => {
  const date = new KtDateTime(value, format);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * 创建 KT 日期时间对象或配置。
 * @param format - format 输入；驱动 `transformKtDateTimeValue()`、`toKtDateTime()` 的 公共基础设施步骤。
 * @returns 创建后的 KT 日期时间对象或配置。
 */
export const createKtDateTimeTransformer = (
  format = KT_DATETIME_FORMAT,
): ValueTransformer => ({
  /**
   * 执行 公共基础设施回调。
   * @param value - 待转换值；驱动 `transformKtDateTimeValue()` 的 公共基础设施步骤。
   */
  from: (value: unknown) => transformKtDateTimeValue(value, format),
  /**
   * 执行 公共基础设施回调。
   * @param value - 待转换值；执行 `value.getTime()` 对应的 公共基础设施步骤。
   */
  to: (value: unknown) => {
    if (value instanceof Date) return new Date(value.getTime());
    if (
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && isDateTimeText(value))
    ) {
      return toKtDateTime(value, format);
    }
    return value;
  },
});

/**
 * 执行 KT 日期时间流程。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtDateTimeColumn(): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtDateTimeColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtDateTimeColumn(format: string): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param options - 公共基础设施列表；影响 KtDateTimeColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtDateTimeColumn(options: ColumnOptions): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtDateTimeColumn 的返回值。
 * @param options - 公共基础设施列表；影响 KtDateTimeColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtDateTimeColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param formatOrOptions - 公共基础设施列表；驱动 `normalizeDateTimeColumnOptions()` 的 公共基础设施步骤。
 * @param options - 公共基础设施列表；使用 `transformer` 字段生成结果。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtDateTimeColumn(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options?: ColumnOptions,
): PropertyDecorator {
  const normalized = normalizeDateTimeColumnOptions(formatOrOptions, options);
  return Column({
    type: 'datetime',
    ...normalized.options,
    transformer: mergeDateTimeTransformer(
      normalized.options.transformer,
      normalized.format,
    ),
  });
}

/**
 * 执行 KT 日期时间流程。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtCreateDateColumn(): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtCreateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtCreateDateColumn(format: string): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param options - 公共基础设施列表；影响 KtCreateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtCreateDateColumn(options: ColumnOptions): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtCreateDateColumn 的返回值。
 * @param options - 公共基础设施列表；影响 KtCreateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtCreateDateColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param formatOrOptions - 公共基础设施列表；驱动 `normalizeDateTimeColumnOptions()` 的 公共基础设施步骤。
 * @param options - 公共基础设施列表；使用 `transformer` 字段生成结果。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtCreateDateColumn(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options?: ColumnOptions,
): PropertyDecorator {
  const normalized = normalizeDateTimeColumnOptions(formatOrOptions, options);
  return CreateDateColumn({
    ...normalized.options,
    transformer: mergeDateTimeTransformer(
      normalized.options.transformer,
      normalized.format,
    ),
  });
}

/**
 * 执行 KT 日期时间流程。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtUpdateDateColumn(): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtUpdateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtUpdateDateColumn(format: string): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param options - 公共基础设施列表；影响 KtUpdateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtUpdateDateColumn(options: ColumnOptions): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtUpdateDateColumn 的返回值。
 * @param options - 公共基础设施列表；影响 KtUpdateDateColumn 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtUpdateDateColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
/**
 * 执行 KT 日期时间流程。
 * @param formatOrOptions - 公共基础设施列表；驱动 `normalizeDateTimeColumnOptions()` 的 公共基础设施步骤。
 * @param options - 公共基础设施列表；使用 `transformer` 字段生成结果。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export function KtUpdateDateColumn(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options?: ColumnOptions,
): PropertyDecorator {
  const normalized = normalizeDateTimeColumnOptions(formatOrOptions, options);
  return UpdateDateColumn({
    ...normalized.options,
    transformer: mergeDateTimeTransformer(
      normalized.options.transformer,
      normalized.format,
    ),
  });
}

/**
 * 执行 KT 日期时间流程。
 * @param format - format 输入；影响 KtDateTimeField 的返回值。
 * @returns KT 日期时间产出的 PropertyDecorator。
 */
export const KtDateTimeField = (
  format = KT_DATETIME_FORMAT,
): PropertyDecorator => {
  return (target, propertyKey) => {
    const fieldKey = propertyKey.toString();
    const formatTarget = target as KtDateTimeRuleTarget;
    const rules = formatTarget[KT_DATETIME_RULES] || [];

    formatTarget[KT_DATETIME_RULES] = [
      ...rules.filter(({ targetKey }) => targetKey !== fieldKey),
      {
        format,
        sourceKey: fieldKey,
        targetKey: fieldKey,
      },
    ];
  };
};

/**
 * 转换 KT 日期时间输入。
 * @param target - target 输入；驱动 `copyEnumerableFields()`、`applyKtDateTimeFields()` 的 公共基础设施步骤。
 * @returns KT 日期时间转换后的值。
 */
export function transformKtDateTimeFields<T extends object>(target: T): T {
  const result = copyEnumerableFields(target) as Record<string, unknown>;

  applyKtDateTimeFields(target, result);

  return result as T;
}

/**
 * 转换 KT 日期时间输入。
 * @param formatOrOptions - 公共基础设施列表；决定 公共基础设施条件分支。
 * @param options - 公共基础设施列表；影响 normalizeDateTimeColumnOptions 的返回值。
 */
function normalizeDateTimeColumnOptions(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options: ColumnOptions = {},
) {
  if (typeof formatOrOptions === 'string') {
    return {
      format: formatOrOptions || KT_DATETIME_FORMAT,
      options,
    };
  }

  return {
    format: KT_DATETIME_FORMAT,
    options: formatOrOptions || {},
  };
}

/**
 * 合并Date Time Transformer。
 * @param existing - existing 输入；驱动 `Array.isArray()` 的 公共基础设施步骤。
 * @param format - format 输入；驱动 `createKtDateTimeTransformer()` 的 公共基础设施步骤。
 */
function mergeDateTimeTransformer(
  existing: ColumnOptions['transformer'],
  format: string,
) {
  const ktTransformer = createKtDateTimeTransformer(format);
  if (!existing) return ktTransformer;

  return Array.isArray(existing)
    ? [...existing, ktTransformer]
    : [existing, ktTransformer];
}

/**
 * 转换 KT 日期时间输入。
 * @param value - 待转换时间值；驱动 `toKtDateTime()` 的 公共基础设施步骤。
 * @param format - format 输入；驱动 `toKtDateTime()` 的 公共基础设施步骤。
 */
function transformKtDateTimeValue(value: unknown, format = KT_DATETIME_FORMAT) {
  if (value == null) return value;
  if (value instanceof KtDateTime) return value;

  if (value instanceof Date) {
    return toKtDateTime(value, format) || value;
  }

  if (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && isDateTimeText(value))
  ) {
    return toKtDateTime(value, format) || value;
  }

  return value;
}

/**
 * 查询 KT 日期时间数据。
 * @param value - 待转换时间值；驱动 `KT_DATETIME_INSTANCE_FORMATS.get()` 的 公共基础设施步骤。
 */
function getKtDateTimeFormat(value: KtDateTime) {
  return KT_DATETIME_INSTANCE_FORMATS.get(value) || KT_DATETIME_FORMAT;
}

/**
 * 判断 KT 日期时间条件。
 * @param value - 待转文本值；计算 公共基础设施判断结果。
 */
function isDateTimeText(value: string) {
  return (
    ISO_DATE_TIME_PATTERN.test(value) || DATE_TIME_TEXT_PATTERN.test(value)
  );
}

/**
 * 查询 KT 日期时间数据。
 * @param target - target 输入；驱动 `Object.getPrototypeOf()` 的 公共基础设施步骤。
 * @returns KT 日期时间查询结果。
 */
function getKtDateTimeRules(target: object): KtDateTimeRule[] {
  const prototype = Object.getPrototypeOf(target);

  return prototype?.[KT_DATETIME_RULES] || [];
}

/**
 * 执行 KT 日期时间流程。
 * @param source - source 输入；驱动 `getKtDateTimeRules()` 的 公共基础设施步骤。
 * @param target - target 输入；影响 applyKtDateTimeFields 的返回值。
 */
function applyKtDateTimeFields(
  source: object,
  target: Record<string, unknown> = source as Record<string, unknown>,
) {
  const sourceRecord = source as Record<string, unknown>;

  getKtDateTimeRules(source).forEach(({ format, sourceKey, targetKey }) => {
    target[targetKey] = transformKtDateTimeValue(
      sourceRecord[sourceKey],
      format,
    );
  });
}

/**
 * 执行 KT 日期时间流程。
 * @param target - target 输入；驱动 `Object.entries()` 的 公共基础设施步骤。
 */
function copyEnumerableFields(target: object) {
  return Object.entries(target).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[key] = value;
      return result;
    },
    {},
  );
}
