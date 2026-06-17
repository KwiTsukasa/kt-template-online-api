import { parseExpression } from 'cron-parser';
import { throwVbenError } from '@/common';

const fieldPattern = /^[\d*/,\-]+$/;

export function normalizeQqbotPluginTaskCron(input: unknown): string {
  const value = `${input || ''}`.trim().replace(/\s+/g, ' ');
  const fields = value.split(' ').filter(Boolean);
  if (fields.length !== 5) {
    throw new Error('定时任务 cron 必须是 5 段表达式');
  }
  if (!fields.every((field) => fieldPattern.test(field))) {
    throw new Error('定时任务 cron 只能包含数字、星号、斜杠、逗号和横线');
  }
  if (fields[0] === '*') {
    throw new Error('定时任务 cron 不允许每分钟执行');
  }
  try {
    parseExpression(fields.join(' '));
  } catch {
    throw new Error('定时任务 cron 表达式不合法');
  }
  return fields.join(' ');
}

export function requireQqbotPluginTaskCron(input: unknown): string {
  try {
    return normalizeQqbotPluginTaskCron(input);
  } catch (error) {
    throwVbenError(
      error instanceof Error ? error.message : '定时任务 cron 不合法',
    );
  }
}
