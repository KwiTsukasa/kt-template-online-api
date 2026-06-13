import { Injectable } from '@nestjs/common';
import {
  RuntimeEvidenceCleanupResult,
  RuntimeEvidenceInput,
  RuntimeEvidenceRecord,
} from './runtime-evidence.types';

const REDACTED_VALUE = '<redacted>';
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|privateKey|sshKey|ticket|randstr|replyText/i;

@Injectable()
export class RuntimeEvidenceService {
  createRecord(input: RuntimeEvidenceInput): RuntimeEvidenceRecord {
    const startedAt = input.startedAt ?? new Date();
    const endedAt = input.endedAt ?? new Date();

    return {
      ...input,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      schemaVersion: 1,
      details: this.sanitizeRecord(input.details),
      cleanup: this.sanitizeCleanup(input.cleanup),
    };
  }

  private sanitizeCleanup(
    cleanup?: RuntimeEvidenceCleanupResult,
  ): RuntimeEvidenceCleanupResult | undefined {
    if (!cleanup) return undefined;

    return {
      ...cleanup,
      details: this.sanitizeRecord(cleanup.details),
    };
  }

  private sanitizeRecord(
    value?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!value) return undefined;
    return this.sanitizeValue(value) as Record<string, unknown>;
  }

  private sanitizeValue(value: unknown): unknown {
    if (value instanceof Date) return value;
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
