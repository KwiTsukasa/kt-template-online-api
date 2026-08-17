import { Injectable } from '@nestjs/common';

@Injectable()
export class QqbotReplyTemplateService {
  /**
   * 根据`template`、`data`绘制或格式化`render` 对应结果。
   * @param template - 决定`render` 对应结果内容、边界或目标的 `template` 值。
   * @param data - 决定`render` 对应结果内容、边界或目标的 `data` 值。
   * @returns 当前状态对应的`render` 对应，取值为 `''`。
   */
  render(template: string | undefined | null, data: Record<string, any>) {
    const source = `${template || ''}`.trim();
    if (!source) return '';
    return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
      const value = this.pickValue(data, path);
      if (value === undefined || value === null) {
        return '';
      }
      return `${value}`;
    });
  }

  /**
   * 按字符串、`replyText` 字段、结构化对象的优先级生成回复文本；空输出返回空字符串。
   * @param output - 用于按字符串、`replyText` 字段、结构化对象的优先级生成回复文本的领域对象，包含 `replyText` 字段。
   * @returns 当前状态对应的按字符串、`replyText` 字段、结构化对象的优先级生成回复文本，取值为 `''`；无法解析或未命中时为 `null`。
   */
  stringifyOutput(output: any) {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (typeof output.replyText === 'string') return output.replyText;
    return JSON.stringify(output, null, 2);
  }

  /**
   * 从`data`、`path`筛选值，并保持保留项的原有顺序与键名。
   * @param data - 决定值内容、边界或目标的 `data` 值。
   * @param path - 必须保持在受控根目录内的路径。
   * @returns 值。
   */
  private pickValue(data: Record<string, any>, path: string) {
    return `${path}`.split('.').reduce((current, key) => current?.[key], data);
  }
}
