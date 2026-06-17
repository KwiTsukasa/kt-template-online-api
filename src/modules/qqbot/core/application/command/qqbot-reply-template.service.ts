import { Injectable } from '@nestjs/common';

@Injectable()
export class QqbotReplyTemplateService {
  /**
   * 渲染 QQBot 核心输出。
   * @param template - template 输入；影响 render 的返回值。
   * @param data - 业务数据；承载 QQBot新增、更新、导入或执行字段。
   */
  render(template: string | undefined | null, data: Record<string, any>) {
    const source = `${template || ''}`.trim();
    if (!source) return '';
    return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
      const value = this.pickValue(data, path);
      return value === undefined || value === null ? '' : `${value}`;
    });
  }

  /**
   * 执行 QQBot 核心流程。
   * @param output - output 输入；使用 `replyText` 字段生成结果。
   */
  stringifyOutput(output: any) {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (typeof output.replyText === 'string') return output.replyText;
    return JSON.stringify(output, null, 2);
  }

  /**
   * 执行 QQBot 核心流程。
   * @param data - 业务数据；承载 QQBot新增、更新、导入或执行字段。
   * @param path - 路由或文件路径；影响 pickValue 的返回值。
   */
  private pickValue(data: Record<string, any>, path: string) {
    return `${path}`.split('.').reduce((current, key) => current?.[key], data);
  }
}
