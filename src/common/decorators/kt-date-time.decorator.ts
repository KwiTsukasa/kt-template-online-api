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
    super(value instanceof Date ? value.getTime() : (value ?? Date.now()));
    KT_DATETIME_INSTANCE_FORMATS.set(this, format);
  }

  toJSON(): string {
    return this.toString();
  }

  toString(): string {
    return formatKtDateTime(this, getKtDateTimeFormat(this));
  }

  [Symbol.toPrimitive](hint: 'number'): number;
  [Symbol.toPrimitive](hint: 'default' | 'string'): string;
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === 'number' ? this.getTime() : this.toString();
  }
}

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

export const toKtDateTime = (
  value: Date | number | string,
  format = KT_DATETIME_FORMAT,
) => {
  const date = new KtDateTime(value, format);
  return Number.isNaN(date.getTime()) ? null : date;
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

export function KtDateTimeColumn(): PropertyDecorator;
export function KtDateTimeColumn(format: string): PropertyDecorator;
export function KtDateTimeColumn(options: ColumnOptions): PropertyDecorator;
export function KtDateTimeColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
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

export function KtCreateDateColumn(): PropertyDecorator;
export function KtCreateDateColumn(format: string): PropertyDecorator;
export function KtCreateDateColumn(options: ColumnOptions): PropertyDecorator;
export function KtCreateDateColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
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

export function KtUpdateDateColumn(): PropertyDecorator;
export function KtUpdateDateColumn(format: string): PropertyDecorator;
export function KtUpdateDateColumn(options: ColumnOptions): PropertyDecorator;
export function KtUpdateDateColumn(
  format: string,
  options: ColumnOptions,
): PropertyDecorator;
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

export function transformKtDateTimeFields<T extends object>(target: T): T {
  const result = copyEnumerableFields(target) as Record<string, unknown>;

  applyKtDateTimeFields(target, result);

  return result as T;
}

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

function getKtDateTimeFormat(value: KtDateTime) {
  return KT_DATETIME_INSTANCE_FORMATS.get(value) || KT_DATETIME_FORMAT;
}

function isDateTimeText(value: string) {
  return (
    ISO_DATE_TIME_PATTERN.test(value) || DATE_TIME_TEXT_PATTERN.test(value)
  );
}

function getKtDateTimeRules(target: object): KtDateTimeRule[] {
  const prototype = Object.getPrototypeOf(target);

  return prototype?.[KT_DATETIME_RULES] || [];
}

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

function copyEnumerableFields(target: object) {
  return Object.entries(target).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[key] = value;
      return result;
    },
    {},
  );
}
