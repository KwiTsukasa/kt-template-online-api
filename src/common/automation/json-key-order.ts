import { JSON_KEY_ORDER } from './constants/identity';

/**
 * 按 JavaScript 默认 UTF-16 次序排列 JSON 键，大分组按字节分桶，最多十六项的末端使用原生排序。
 * @param input - 普通 JSON 对象的字段名，不修改调用方数组。
 * @returns 与默认字符串排序逐项一致的键；总访问量随键的总字符数线性增长。
 */
export function orderJsonKeys(input: readonly string[]): string[] {
  const keys = [...input];
  const scratch: string[] = new Array(keys.length);
  const pending = [{ from: 0, to: keys.length, byte: 0 }];
  while (pending.length) {
    const group = pending.pop()!;
    const size = group.to - group.from;
    if (size < 2) continue;
    if (size <= JSON_KEY_ORDER.smallGroup) {
      const sorted = keys.slice(group.from, group.to).sort();
      for (let index = 0; index < sorted.length; index++)
        keys[group.from + index] = sorted[index];
      continue;
    }
    const counts = new Uint32Array(JSON_KEY_ORDER.byteBuckets);
    for (let index = group.from; index < group.to; index++)
      counts[keyByte(keys[index], group.byte)]++;
    const positions = new Uint32Array(JSON_KEY_ORDER.byteBuckets);
    let position = group.from;
    for (let bucket = 0; bucket < counts.length; bucket++) {
      positions[bucket] = position;
      const end = position + counts[bucket];
      if (bucket > 0 && counts[bucket] > 1)
        pending.push({ from: position, to: end, byte: group.byte + 1 });
      position = end;
    }
    for (let index = group.from; index < group.to; index++) {
      const key = keys[index];
      scratch[positions[keyByte(key, group.byte)]++] = key;
    }
    for (let index = group.from; index < group.to; index++)
      keys[index] = scratch[index];
  }
  return keys;
}

/**
 * 将 UTF-16 码元拆成高、低字节，零桶只表示字符串结束，空字符仍排在结束之后。
 * @param key - 当前字段名。
 * @param offset - 从零开始的字节位置。
 * @returns 字符串结束为零，否则为一至二百五十六的桶编号。
 */
function keyByte(key: string, offset: number): number {
  const index = Math.floor(offset / 2);
  if (index >= key.length) return 0;
  const code = key.charCodeAt(index);
  if (offset % 2 === 0) return (code >>> 8) + 1;
  return (code & 255) + 1;
}
