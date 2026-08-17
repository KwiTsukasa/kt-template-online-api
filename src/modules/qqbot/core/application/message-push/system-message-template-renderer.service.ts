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

/**
 * 从输入或当前状态提取代码点长度。
 * @param value - 参与代码PointLength比较、格式化或输出的候选值。
 * @returns 代码PointLength。
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * 以 `template_invalid` 契约错误统一拒绝结构、变量或边界不合法的系统消息模板。
 * @throws 调用该拒绝辅助函数时固定抛出代码为 `template_invalid` 的 `SystemMessageContractError`。
 */
function throwTemplateInvalid(): never {
  throw new SystemMessageContractError('template_invalid');
}

@Injectable()
export class SystemMessageTemplateRendererService {
  /**
   * 从`content`、`allowedVariables`解析系统消息模板渲染器记录。
   * @param content - 用于系统消息模板渲染器记录的领域对象，包含 `length`、`cursor` 字段。
   * @param allowedVariables - 决定是否启用“许可范围Variables”分支的布尔选项。
   * @returns 按输入顺序得到的系统消息模板渲染器记录列表；没有匹配项时为空数组。
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
   * 校验`content`、`allowedVariables`是否满足系统消息模板渲染器记录约束，并拒绝不合法输入。
   * @param content - 决定系统消息模板渲染器记录内容、边界或目标的 `content` 值。
   * @param allowedVariables - 决定是否启用“许可范围Variables”分支的布尔选项。
   */
  validate(content: string, allowedVariables: readonly string[]): void {
    this.parse(content, allowedVariables);
  }

  /**
   * 解析系统消息模板并替换全部变量，同时限制单个字符串变量和最终消息的码点长度。
   * @param content - 包含文本与变量占位符的系统消息模板。
   * @param variables - 为模板占位符提供布尔值、有限数值或字符串的变量映射。
   * @returns 按模板顺序替换变量后拼接得到的消息文本。
   * @throws 任一字符串变量或最终消息超过相应码点上限时抛出 `SystemMessageContractError`。
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
   * 根据`tokens`、`value`更新文本；当 `previous?.kind === 'text'` 成立时直接结束且不产生返回值。
   * @param tokens - 按原有顺序参与文本筛选、合并或汇总的集合。
   * @param value - 参与文本比较、格式化或输出的候选值。
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
