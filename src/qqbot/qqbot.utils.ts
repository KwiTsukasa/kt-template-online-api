import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from './qqbot.constants';

export type QqbotPageQuery = {
  pageNo?: number | string;
  pageSize?: number | string;
};

export function toStringId(value: number | string | undefined) {
  return value === undefined || value === null ? '' : `${value}`;
}

export function toNumber(value: number | string | undefined, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
}

export function getPageParams(query: QqbotPageQuery = {}) {
  const pageNo = toNumber(query.pageNo, QQBOT_DEFAULT_PAGE_NO);
  const pageSize = toNumber(query.pageSize, QQBOT_DEFAULT_PAGE_SIZE);
  return {
    pageNo,
    pageSize,
    skip: (pageNo - 1) * pageSize,
  };
}

export function normalizeBoolean(value: any, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
}

export function normalizeNullableString(value: any) {
  if (value === undefined || value === null) return null;
  const nextValue = `${value}`.trim();
  return nextValue ? nextValue : null;
}
