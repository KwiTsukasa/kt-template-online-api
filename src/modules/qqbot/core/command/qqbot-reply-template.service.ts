import { Injectable } from '@nestjs/common';

@Injectable()
export class QqbotReplyTemplateService {
  render(template: string | undefined | null, data: Record<string, any>) {
    const source = `${template || ''}`.trim();
    if (!source) return '';
    return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
      const value = this.pickValue(data, path);
      return value === undefined || value === null ? '' : `${value}`;
    });
  }

  stringifyOutput(output: any) {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (typeof output.replyText === 'string') return output.replyText;
    return JSON.stringify(output, null, 2);
  }

  private pickValue(data: Record<string, any>, path: string) {
    return `${path}`
      .split('.')
      .reduce((current, key) => current?.[key], data);
  }
}
