import { parseExpression } from 'cron-parser';

/**
 * 验证插件清单中的建议周期，保持旧清单的五段表达式与频率约束。
 * @param input - 插件包声明的建议 Cron 周期。
 * @returns 压缩空格后的合法建议周期；此校验不会创建任何触发器。
 * @throws 段数、字符、最低频率或日期范围无效时拒绝插件清单。
 */
export function normalizePluginTaskCron(input: unknown): string {
  const fields = String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (fields.length !== 5) throw new Error('定时任务 cron 必须是 5 段表达式');
  if (!fields.every((field) => /^[\d*/,\-]+$/.test(field)))
    throw new Error('定时任务 cron 只能包含数字、星号、斜杠、逗号和横线');
  if (fields[0] === '*') throw new Error('定时任务 cron 不允许每分钟执行');
  try {
    parseExpression(fields.join(' '));
  } catch {
    throw new Error('定时任务 cron 表达式不合法');
  }
  return fields.join(' ');
}
