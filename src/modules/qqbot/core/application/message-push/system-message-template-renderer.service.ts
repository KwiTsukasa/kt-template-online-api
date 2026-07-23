import { Injectable } from '@nestjs/common';
import {
  SystemMessageContractError,
  type SystemMessageTemplateToken,
} from '../../contract/message-push/qqbot-message-push.types';

const DANGEROUS_VARIABLE_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const VARIABLE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const MAX_TEMPLATE_CONTENT_CODE_POINTS = 2_000;
const MAX_VARIABLE_STRING_CODE_POINTS = 500;
const MAX_RENDERED_MESSAGE_CODE_POINTS = 4_000;

/** Counts Unicode code points instead of UTF-16 code units. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Throws the stable error used for every malformed template protocol input. */
function throwTemplateInvalid(): never {
  throw new SystemMessageContractError('template_invalid');
}

/**
 * Parses and renders the deliberately small system-message template protocol.
 *
 * It recognizes only complete `${{identifier}}` tokens and never evaluates an
 * expression, traverses object properties, or interprets CQ-looking text.
 */
@Injectable()
export class SystemMessageTemplateRendererService {
  /**
   * Parses one template into ordered text and allowlisted variable tokens.
   * @param content - Untrusted template text, limited to 2,000 Unicode code points.
   * @param allowedVariables - Exact variable names provided by the source definition.
   * @returns Consecutive ordered text and variable tokens; malformed syntax throws `template_invalid`.
   */
  parse(
    content: string,
    allowedVariables: readonly string[],
  ): SystemMessageTemplateToken[] {
    if (typeof content !== 'string') throwTemplateInvalid();
    if (codePointLength(content) > MAX_TEMPLATE_CONTENT_CODE_POINTS) {
      throwTemplateInvalid();
    }

    const allowed = new Set(allowedVariables);
    const tokens: SystemMessageTemplateToken[] = [];
    let cursor = 0;

    while (cursor < content.length) {
      const openingIndex = content.indexOf('${{', cursor);
      const closingIndex = content.indexOf('}}', cursor);
      if (openingIndex === -1) {
        if (closingIndex !== -1) throwTemplateInvalid();
        this.appendText(tokens, content.slice(cursor));
        break;
      }
      if (closingIndex !== -1 && closingIndex < openingIndex) {
        throwTemplateInvalid();
      }

      this.appendText(tokens, content.slice(cursor, openingIndex));
      const tokenEnd = content.indexOf('}}', openingIndex + 3);
      const nestedOpeningIndex = content.indexOf('${{', openingIndex + 3);
      if (
        tokenEnd === -1 ||
        (nestedOpeningIndex !== -1 && nestedOpeningIndex < tokenEnd)
      ) {
        throwTemplateInvalid();
      }

      const key = content.slice(openingIndex + 3, tokenEnd);
      if (
        !VARIABLE_IDENTIFIER.test(key) ||
        DANGEROUS_VARIABLE_KEYS.has(key) ||
        !allowed.has(key)
      ) {
        throwTemplateInvalid();
      }
      tokens.push({ key, kind: 'variable' });
      cursor = tokenEnd + 2;

      // A third closing brace overlaps the token's closing pair and is still an extra `}}`.
      if (content[cursor] === '}') throwTemplateInvalid();
    }

    return tokens;
  }

  /**
   * Validates the same token stream used by rendering without producing output.
   * @param content - Untrusted template text.
   * @param allowedVariables - Exact source-defined variable names.
   * @returns Nothing when the template protocol is safe; otherwise throws `template_invalid`.
   */
  validate(content: string, allowedVariables: readonly string[]): void {
    this.parse(content, allowedVariables);
  }

  /**
   * Replaces validated variable tokens with scalar strings and leaves all other text literal.
   * @param content - Template content following the strict `${{identifier}}` protocol.
   * @param variables - Own scalar variables available to this render operation.
   * @returns Plain rendered message text, capped at 4,000 Unicode code points.
   * @throws {SystemMessageContractError} For invalid templates, invalid values, or size limits.
   */
  render(
    content: string,
    variables: Record<string, boolean | number | string>,
  ): string {
    if (
      !variables ||
      typeof variables !== 'object' ||
      Array.isArray(variables)
    ) {
      throwTemplateInvalid();
    }
    const tokens = this.parse(content, Object.keys(variables));
    for (const value of Object.values(variables)) {
      if (typeof value === 'string') {
        if (codePointLength(value) > MAX_VARIABLE_STRING_CODE_POINTS) {
          throw new SystemMessageContractError('template_variable_too_long');
        }
        continue;
      }
      if (
        typeof value !== 'boolean' &&
        (typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throwTemplateInvalid();
      }
    }

    const rendered = tokens
      .map((token) => {
        if (token.kind === 'text') return token.value;
        const value = variables[token.key];
        if (!Object.prototype.hasOwnProperty.call(variables, token.key)) {
          throwTemplateInvalid();
        }
        return String(value);
      })
      .join('');
    if (codePointLength(rendered) > MAX_RENDERED_MESSAGE_CODE_POINTS) {
      throw new SystemMessageContractError('rendered_message_too_long');
    }
    return rendered;
  }

  /**
   * Adds literal text while preserving the compact token representation.
   * @param tokens - Mutable parser result in source order.
   * @param value - Literal source slice to append.
   * @returns Nothing; adjacent literal slices are merged in place.
   */
  private appendText(
    tokens: SystemMessageTemplateToken[],
    value: string,
  ): void {
    if (!value) return;
    const previous = tokens.at(-1);
    if (previous?.kind === 'text') {
      previous.value += value;
      return;
    }
    tokens.push({ kind: 'text', value });
  }
}
