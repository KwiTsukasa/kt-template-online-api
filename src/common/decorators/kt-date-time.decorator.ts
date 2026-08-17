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

const padDateUnit = (value: number) => `${value}`.padStart(2, '0');

export class KtDateTime extends Date {
  constructor(value?: Date | number | string, format = KT_DATETIME_FORMAT) {
    super((() => {
      if (value instanceof Date) {
        return value.getTime();
      }
      return (value ?? Date.now());
    })());
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
   * 按实例关联的格式将 KT 日期时间渲染为字符串。
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
   * 根据`hint`处理针对处理对象的原始值转换；当 `hint === 'number'` 成立时返回 `this.getTime()`。
   * @param hint - 决定针对处理对象的原始值转换内容、边界或目标的 `hint` 值。
   * @returns 针对处理对象的原始值转换。
   */
  [Symbol.toPrimitive](hint: string): string | number {
    if (hint === 'number') {
      return this.getTime();
    }
    return this.toString();
  }
}

export const formatKtDateTime = (
  value: Date | number | string,
  format = KT_DATETIME_FORMAT,
): string => {
  const date = (() => {
    if (value instanceof Date) {
      return value;
    }
    return new Date(value);
  })();
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

export const toKtDateTime = (
  value: Date | number | string,
  format = KT_DATETIME_FORMAT,
) => {
  const date = new KtDateTime(value, format);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

export const createKtDateTimeTransformer = (
  format = KT_DATETIME_FORMAT,
): ValueTransformer => ({
  from: (value: unknown) => transformKtDateTimeValue(value, format),
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
 * 根据`formatOrOptions`、`options`处理针对KT 日期时间。
 * @param formatOrOptions - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param options - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 针对KT 日期时间。
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
 * 根据`formatOrOptions`、`options`处理针对KT 日期时间。
 * @param formatOrOptions - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param options - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 针对KT 日期时间。
 */
export function KtCreateDateColumn(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options?: ColumnOptions,
): PropertyDecorator {
  const normalized = normalizeDateTimeColumnOptions(formatOrOptions, options);
  const columnOptions = applyCurrentTimestampPrecision(normalized.options);
  return CreateDateColumn({
    ...columnOptions,
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
 * 根据`formatOrOptions`、`options`处理针对KT 日期时间。
 * @param formatOrOptions - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @param options - 控制针对KT 日期时间筛选、缓存或输出方式的可选项；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 针对KT 日期时间。
 */
export function KtUpdateDateColumn(
  formatOrOptions?: KtDateTimeDecoratorOptions,
  options?: ColumnOptions,
): PropertyDecorator {
  const normalized = normalizeDateTimeColumnOptions(formatOrOptions, options);
  const columnOptions = applyCurrentTimestampPrecision(
    normalized.options,
    true,
  );
  return UpdateDateColumn({
    ...columnOptions,
    transformer: mergeDateTimeTransformer(
      normalized.options.transformer,
      normalized.format,
    ),
  });
}

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
 * 根据`target`处理针对KT 日期时间。
 * @param target - 决定针对KT 日期时间内容、边界或目标的 `target` 值。
 * @returns 针对KT 日期时间。
 */
export function transformKtDateTimeFields<T extends object>(target: T): T {
  const result = copyEnumerableFields(target) as Record<string, unknown>;

  applyKtDateTimeFields(target, result);

  return result as T;
}

/**
 * 将`formatOrOptions`、`options`规范为包含 `format`、`options` 字段的结果，使等价输入得到一致表示；当 `typeof formatOrOptions === 'string'` 成立时返回 `{ format: formatOrOptions || KT_DATETIME_FO…`。
 * @param formatOrOptions - 控制包含 `format`、`options` 字段的结果筛选、缓存或输出方式的可选项；为空时采用 `KT_DATETIME_FORMAT` 作为兜底。
 * @param options - 控制包含 `format`、`options` 字段的结果筛选、缓存或输出方式的可选项；省略时默认采用 `{}`。
 * @returns 包含 `format`、`options` 字段的包含 `format`、`options` 字段的。
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
 * 根据`options`、`includeOnUpdate`更新当前时间戳精度。
 * @param options - 控制当前时间戳精度筛选、缓存或输出方式的可选项，包含 `precision`、`default`、`onUpdate` 字段。
 * @param includeOnUpdate - 决定是否启用“include”分支的布尔选项；省略时默认采用 `false`。
 * @returns 包含 `default` 字段的当前时间戳精度；没有可用结果或提前结束时为 `undefined`。
 */
function applyCurrentTimestampPrecision(
  options: ColumnOptions,
  includeOnUpdate = false,
): ColumnOptions {
  if (options.precision === undefined) return options;

  const currentTimestamp = `CURRENT_TIMESTAMP(${options.precision})`;
  return {
    ...options,
    default:
      (() => {
        if (options.default === undefined) {
          return () => currentTimestamp;
        }
        return options.default;
      })(),
    ...((() => {
      if (includeOnUpdate && options.onUpdate === undefined) {
        return { onUpdate: currentTimestamp };
      }
      return {};
    })()),
  };
}

/**
 * 创建指定格式的 KT 日期时间转换器；没有既有转换器时直接返回，已有单项或数组时将新转换器追加到链尾。
 * @param existing - 决定指定格式的 KT 日期时间转换器内容、边界或目标的 `existing` 值。
 * @param format - 决定指定格式的 KT 日期时间转换器内容、边界或目标的 `format` 值。
 * @returns 按输入顺序得到的指定格式的 KT 日期时间转换器列表；没有匹配项时为空数组。
 */
function mergeDateTimeTransformer(
  existing: ColumnOptions['transformer'],
  format: string,
) {
  const ktTransformer = createKtDateTimeTransformer(format);
  if (!existing) return ktTransformer;

  if (Array.isArray(existing)) {
    return [...existing, ktTransformer];
  }
  return [existing, ktTransformer];
}

/**
 * 根据`value`、`format`处理针对KT 日期时间；当 `value instanceof Date` 成立时返回 `toKtDateTime(value, format) || value`。
 * @param value - 参与针对KT 日期时间比较、格式化或输出的候选值。
 * @param format - 决定针对KT 日期时间内容、边界或目标的 `format` 值；省略时默认采用 `KT_DATETIME_FORMAT`。
 * @returns 针对KT 日期时间。
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
 * 按`value`读取针对KT 日期时间；从 `KT_DATETIME_INSTANCE_FORMATS.get` 读取针对KT 日期时间。
 * @param value - 参与针对KT 日期时间比较、格式化或输出的候选值。
 * @returns 规范化后的针对KT 日期时间；主值为空时采用 `KT_DATETIME_FORMAT` 兜底。
 */
function getKtDateTimeFormat(value: KtDateTime) {
  return KT_DATETIME_INSTANCE_FORMATS.get(value) || KT_DATETIME_FORMAT;
}

/**
 * 根据`value`与当前约束判定针对KT 日期时间。
 * @param value - 待判定是否满足针对KT 日期时间约束的候选值。
 * @returns 满足针对KT 日期时间约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isDateTimeText(value: string) {
  return (
    ISO_DATE_TIME_PATTERN.test(value) || DATE_TIME_TEXT_PATTERN.test(value)
  );
}

/**
 * 按`target`读取针对KT 日期时间。
 * @param target - 决定针对KT 日期时间内容、边界或目标的 `target` 值。
 * @returns 按输入顺序得到的针对KT 日期时间列表；没有匹配项时为空数组。
 */
function getKtDateTimeRules(target: object): KtDateTimeRule[] {
  const prototype = Object.getPrototypeOf(target);

  return prototype?.[KT_DATETIME_RULES] || [];
}

/**
 * 根据`source`、`target`更新针对KT 日期时间；从 `getKtDateTimeRules` 读取针对KT 日期时间。
 * @param source - 决定针对KT 日期时间内容、边界或目标的 `source` 值。
 * @param target - 用于针对KT 日期时间的领域对象，包含 `targetKey` 字段；省略时默认采用 `source as Record<string, unknown>`。
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
 * 根据`target`处理针对KT 日期时间。
 * @param target - 决定针对KT 日期时间内容、边界或目标的 `target` 值。
 * @returns 针对KT 日期时间。
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
