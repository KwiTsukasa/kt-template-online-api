import { createHash } from 'node:crypto';
import {
  AUTOMATION_DIGEST_ALGORITHM,
  AUTOMATION_DIGEST_ENCODING,
} from './constants/identity';

/**
 * 为自动化内容生成统一的 SHA-256 十六进制摘要，文本按 UTF-8 编码，二进制按原字节计算。
 * @param content - 已确定序列化方式的文本或二进制内容。
 * @returns 小写六十四位摘要，调用方负责确定需要密封的业务字段。
 */
export function automationDigest(content: string | Buffer): string {
  return createHash(AUTOMATION_DIGEST_ALGORITHM)
    .update(content)
    .digest(AUTOMATION_DIGEST_ENCODING);
}

/**
 * 保持既有幂等请求的字段排序约定，调用方输入字段顺序不会改变摘要，值与嵌套内容保持原样。
 * @param values - 经过所属业务契约检查的标量字段字典。
 * @returns 按既有字段名比较规则排序的键值对，不修改输入对象。
 */
export function automationFieldEntries(
  values: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(values).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}
