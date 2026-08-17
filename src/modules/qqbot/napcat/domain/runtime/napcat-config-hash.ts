import { createHash } from 'crypto';

/** 返回稳定的JSON摘要。 */
export function stableJsonHash(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** 返回稳定的序列化。 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

/** 排序JSON值。 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
