import { Injectable } from '@nestjs/common';
import {
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

const REDACTED_VALUE = '<redacted>';
const REDACTED_BASE64_VALUE = '<redacted-base64>';
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|privatekey|sshkey|ticket|randstr|replytext|base64/i;
const SENSITIVE_TEXT_KEY_PATTERN =
  '(?:[A-Za-z0-9_-]*(?:password|secret|token|authorization|cookie|private[_-]?key|ssh[_-]?key|ticket|randstr|replyText|base64)[A-Za-z0-9_-]*|sid)';
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi,
    REDACTED_BASE64_VALUE,
  ],
  [/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, REDACTED_BASE64_VALUE],
  [/\b(Authorization)\s*[:=]\s*[^\r\n]+/gi, '$1=<redacted>'],
  [/\b(Cookie)\s*[:=]\s*[^\r\n]+/gi, '$1=<redacted>'],
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
          this.isSensitiveKey(key) ? REDACTED_VALUE : this.sanitizeValue(entry),
        ]),
      );
    }
    return value;
  }

  private sanitizeText(value: string) {
    return SENSITIVE_TEXT_REPLACEMENTS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      value,
    );
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    );
  }

  private isSensitiveKey(key: string) {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return normalizedKey === 'sid' || SENSITIVE_KEY_PATTERN.test(normalizedKey);
  }
}
