/**
 * 描述长结果的字段路径和集合大小，供调用方选择需要读取的部分。
 * @param value - 命令返回的 JSON 值。
 * @param depth - 剩余的对象展开层数。
 * @returns 有界结构摘要，不替代完整原始结果。
 */
export function describeToolResult(value: unknown, depth = 3): unknown {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'string')
    return { type: 'string', length: value.length };
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (!depth) return { type: 'object', keys: keys.slice(0, 30) };
  return Object.fromEntries(
    keys
      .slice(0, 30)
      .map((key) => [key, describeToolResult(value[key], depth - 1)]),
  );
}

/**
 * 按显式字段路径分段读取完整 JSON，偏移量始终对应所选值的序列化文本。
 * @param value - 当前授权内已持久保存的原始命令结果。
 * @param input - 字段路径、字符偏移和单页字符数。
 * @returns 原始 JSON 文本片段及下一页偏移，末页返回空游标。
 * @throws 路径不存在、使用原型字段或分页参数越界时拒绝读取。
 */
export function readToolResultPage(
  value: unknown,
  input: Record<string, unknown>,
) {
  const path = input.path ?? [];
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 6000;
  if (
    !Array.isArray(path) ||
    path.length > 12 ||
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 8000
  )
    throw new Error('结果分页参数无效');
  let selected = value;
  for (const key of path) {
    if (
      typeof key !== 'string' ||
      ['__proto__', 'prototype', 'constructor'].includes(key) ||
      !selected ||
      typeof selected !== 'object' ||
      !Object.hasOwn(selected, key)
    )
      throw new Error('结果字段路径不存在');
    selected = selected[key];
  }
  const text = JSON.stringify(selected);
  let end = Math.min(text.length, Number(offset) + Number(limit));
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) {
    if (end - 1 === offset) end += 1;
    else end -= 1;
  }
  let nextOffset: number | null = null;
  if (end < text.length) nextOffset = end;
  return {
    path,
    offset,
    totalCharacters: text.length,
    text: text.slice(Number(offset), end),
    nextOffset,
  };
}
