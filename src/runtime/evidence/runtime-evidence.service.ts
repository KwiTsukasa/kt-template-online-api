import { Injectable } from '@nestjs/common';
import {
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

const REDACTED_VALUE = '<redacted>';
const REDACTED_BASE64_VALUE = '<redacted-base64>';
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|privatekey|sshkey|accesskey|apikey|ticket|randstr|replytext|base64/i;
const SENSITIVE_TEXT_KEY_PATTERN =
  '(?:[A-Za-z0-9_-]*(?:password|secret|token|authorization|cookie|private[_-]?key|ssh[_-]?key|access[_-]?key|api[_-]?key|ticket|randstr|replyText|base64)[A-Za-z0-9_-]*|sid)';
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi,
    REDACTED_BASE64_VALUE,
  ],
  [/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, REDACTED_BASE64_VALUE],
  [/\b(Authorization)\s*[:=]\s*[^\r\n]+/gi, '$1=<redacted>'],
  [/\b(Cookie)\s*[:=]\s*[^\r\n]+/gi, '$1=<redacted>'],
  [
    /\b((?:private|ssh)[_-]?key)(\s*[:=]\s*)-----BEGIN[\s\S]*?-----END [^-]+-----/gi,
    '$1$2<redacted>',
  ],
  [
    /\b((?:private|ssh)[_-]?key)(\s*[:=]\s*)-----BEGIN[\s\S]*?(?=\s+[A-Za-z0-9_-]+\s*[:=]|\s*$)/gi,
    '$1$2<redacted>',
  ],
  [
    new RegExp(
      `\\b(${SENSITIVE_TEXT_KEY_PATTERN})(\\s*[:=]\\s*)Bearer\\s+[^\\s,;&]+`,
      'gi',
    ),
    '$1$2<redacted>',
  ],
  [
    new RegExp(
      `(["'])(${SENSITIVE_TEXT_KEY_PATTERN})\\1\\s*:\\s*(?:(["'])[^"']*\\3|[-+]?\\d+(?:\\.\\d+)?|true|false|null)`,
      'gi',
    ),
    '$1$2$1:"<redacted>"',
  ],
  [
    new RegExp(
      `\\b(${SENSITIVE_TEXT_KEY_PATTERN})(\\s*[:=]\\s*)(["'])[^"']*\\3`,
      'gi',
    ),
    '$1$2$3<redacted>$3',
  ],
  [
    new RegExp(
      `\\b(${SENSITIVE_TEXT_KEY_PATTERN})(\\s*[:=]\\s*)[^\\s,;&]+`,
      'gi',
    ),
    '$1$2<redacted>',
  ],
];

@Injectable()
export class RuntimeEvidenceService {
  /**
   * 根据`input`构造针对运行态健康检查；从 `endedAt.getTime` 读取针对运行态健康检查。
   * @param input - 用于针对运行态健康检查的结构化输入，包含 `startedAt`、`endedAt` 字段。
   * @returns 针对运行态健康检查。
   */
  createRecord(input: RuntimeEvidenceInput): RuntimeEvidenceRecord {
    const startedAt = input.startedAt ?? new Date();
    const endedAt = input.endedAt ?? new Date();
    const record: RuntimeEvidenceRecord = {
      ...input,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      schemaVersion: 1,
    };

    return this.sanitizeValue(record) as RuntimeEvidenceRecord;
  }

  /**
   * 将`value`规范为针对运行态健康检查，使等价输入得到一致表示；当 `Array.isArray(value)` 成立时返回 `value.map((item) => this.sanitizeValue(item…`。
   * @param value - 参与针对运行态健康检查比较、格式化或输出的候选值。
   * @returns 针对运行态健康检查。
   */
  private sanitizeValue(value: unknown): unknown {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return this.sanitizeText(value);
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (this.isPlainRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          (() => {
            if (this.isSensitiveKey(key)) {
              return REDACTED_VALUE;
            }
            return this.sanitizeValue(entry);
          })(),
        ]),
      );
    }
    return value;
  }

  /**
   * 将`value`规范为针对运行态健康检查，使等价输入得到一致表示。
   * @param value - 参与针对运行态健康检查比较、格式化或输出的候选值。
   * @returns 针对运行态健康检查。
   */
  private sanitizeText(value: string) {
    return SENSITIVE_TEXT_REPLACEMENTS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      value,
    );
  }

  /**
   * 针对运行态健康检查，根据 `typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanc…` 判定输入是否满足条件。
   * @param value - 待判定是否满足Plain记录约束的候选值。
   * @returns 满足Plain记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
   */
  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    );
  }

  /**
   * 根据`key`与当前约束判定针对运行态健康检查。
   * @param key - 用于读取或更新针对运行态健康检查的稳定键。
   * @returns 满足针对运行态健康检查约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isSensitiveKey(key: string) {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return normalizedKey === 'sid' || SENSITIVE_KEY_PATTERN.test(normalizedKey);
  }
}
