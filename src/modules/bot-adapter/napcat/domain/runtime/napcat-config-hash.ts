import { createHash } from 'crypto';

/**
 * 按规范字段顺序计算稳定的JSON摘要。
 * @param value - 参与按规范字段顺序计算稳定的JSON摘要比较、格式化或输出的候选值。
 * @returns 按规范字段顺序计算稳定的JSON摘要。
 */
export function stableJsonHash(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * 递归排序对象键后序列化 JSON，使字段插入顺序不同的等价配置得到相同文本。
 * @param value - 参与递归排序对象键后序列化 JSON，使字段插入顺序不同的等价配置得到相同文本比较、格式化或输出的候选值。
 * @returns 稳定Stringify。
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

/**
 * 根据`value`处理JSON值；当 `Array.isArray(value)` 成立时返回 `value.map((item) => sortJsonValue(item))`。
 * @param value - 参与JSON值比较、格式化或输出的候选值。
 * @returns JSON值。
 */
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
