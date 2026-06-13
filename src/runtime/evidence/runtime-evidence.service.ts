import { Injectable } from '@nestjs/common';
import {
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

const REDACTED_VALUE = '<redacted>';
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|privateKey|sshKey|ticket|randstr|replyText/i;
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(Authorization)\s*[:=]\s*Bearer\s+[^\s,;]+/gi, '$1=<redacted>'],
  [/\b(Cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>'],
  [/\b(ticket|randstr|token|replyText)\s*=\s*[^\s,;&]+/gi, '$1=<redacted>'],
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
    return SENSITIVE_KEY_PATTERN.test(key);
  }
}
