import { createHash } from 'node:crypto';

/**
 * 按键名递归排序后序列化 JSON 值，确保跨进程摘要输入稳定。
 * @param value - 需要稳定序列化的 JSON 值。
 * @returns 键顺序确定的 JSON 字符串。
 */
export function canonicalMediaGovernanceJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonicalMediaGovernanceJson(item))
      .join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalMediaGovernanceJson(object[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 对媒体治理稳定 JSON 表示计算小写十六进制 SHA-256 摘要。
 * @param value - 需要生成摘要的 JSON 值。
 * @returns 稳定 JSON 对应的 SHA-256 摘要。
 */
export function sha256MediaGovernanceJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalMediaGovernanceJson(value))
    .digest('hex');
}
