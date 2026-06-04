import { AfterLoad } from 'typeorm';

export const KT_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const DATE_TIME_FORMAT_RULES = Symbol('DATE_TIME_FORMAT_RULES');
const DATE_TIME_FORMAT_HOOK_REGISTERED = Symbol(
  'DATE_TIME_FORMAT_HOOK_REGISTERED',
);
const DATE_TIME_FORMAT_HOOK = '__ktFormatDateTimeFields';
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;
const DATE_TIME_TEXT_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

type DateTimeFormatRule = {
  sourceKey: string;
  targetKey: string;
};

type DateTimeFormatTarget = Record<PropertyKey, any> & {
  [DATE_TIME_FORMAT_HOOK_REGISTERED]?: boolean;
  [DATE_TIME_FORMAT_RULES]?: DateTimeFormatRule[];
};

const padDateUnit = (value: number) => `${value}`.padStart(2, '0');

export const formatKtDateTime = (value: Date | number | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return [
    `${date.getFullYear()}-${padDateUnit(date.getMonth() + 1)}-${padDateUnit(
      date.getDate(),
    )}`,
    `${padDateUnit(date.getHours())}:${padDateUnit(
      date.getMinutes(),
    )}:${padDateUnit(date.getSeconds())}`,
  ].join(' ');
};

const formatDateTimeFieldValue = (value: unknown) => {
  if (value instanceof Date) {
    return formatKtDateTime(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatKtDateTime(value);
  }

  if (typeof value === 'string' && isDateTimeText(value)) {
    const formatted = formatKtDateTime(value);
    return formatted || value;
  }

  return value;
};

const isDateTimeText = (value: string) =>
  ISO_DATE_TIME_PATTERN.test(value) || DATE_TIME_TEXT_PATTERN.test(value);

const getDateTimeFormatRules = (target: object): DateTimeFormatRule[] => {
  const prototype = Object.getPrototypeOf(target);

  return prototype?.[DATE_TIME_FORMAT_RULES] || [];
};

const ensureDateTimeFormatHook = (target: DateTimeFormatTarget) => {
  if (target[DATE_TIME_FORMAT_HOOK_REGISTERED]) return;

  Object.defineProperty(target, DATE_TIME_FORMAT_HOOK, {
    configurable: true,
    value: function (this: object) {
      formatDateTimeFields(this);
    },
  });

  AfterLoad()(target, DATE_TIME_FORMAT_HOOK);
  target[DATE_TIME_FORMAT_HOOK_REGISTERED] = true;
};

export const FormatDateTime = (): PropertyDecorator => {
  return (target, propertyKey) => {
    const fieldKey = propertyKey.toString();
    const rules = target[DATE_TIME_FORMAT_RULES] || [];

    target[DATE_TIME_FORMAT_RULES] = [
      ...rules.filter(({ targetKey }) => targetKey !== fieldKey),
      {
        sourceKey: fieldKey,
        targetKey: fieldKey,
      },
    ];
    ensureDateTimeFormatHook(target as DateTimeFormatTarget);
  };
};

export function formatDateTimeFields<T extends object>(target: T): T {
  getDateTimeFormatRules(target).forEach(({ sourceKey, targetKey }) => {
    target[targetKey] = formatDateTimeFieldValue(target[sourceKey]);
  });

  return target;
}
