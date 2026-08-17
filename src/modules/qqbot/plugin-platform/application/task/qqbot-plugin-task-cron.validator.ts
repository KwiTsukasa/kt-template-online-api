import { parseExpression } from 'cron-parser';
import { throwVbenError } from '@/common';

const fieldPattern = /^[\d*/,\-]+$/;

/**
 * 将`input`规范为Qqbot插件任务Cron，使等价输入得到一致表示。
 * @param input - 用于Qqbot插件任务Cron的结构化输入。
 * @returns Qqbot插件任务Cron。
 * @throws 当 `fields.length !== 5` 成立时拒绝当前输入并抛出 `Error`；当 `!fields.every((field) => fieldPattern.test(field))` 成立时拒绝当前输入并抛出 `Error`；当 `fields[0] === '*'` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `parseExpression` 或 `fields.join` 调用失败时拒绝当前输入并抛出 `Error`。
 */
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

/**
 * 校验`input`是否满足Qqbot插件任务Cron约束，并拒绝不合法输入。
 * @param input - 用于Qqbot插件任务Cron的结构化输入。
 * @returns Qqbot插件任务Cron。
 */
export function requireQqbotPluginTaskCron(input: unknown): string {
  try {
    return normalizeQqbotPluginTaskCron(input);
  } catch (error) {
    throwVbenError(
      (() => {
        if (error instanceof Error) {
          return error.message;
        }
        return '定时任务 cron 不合法';
      })(),
    );
  }
}
