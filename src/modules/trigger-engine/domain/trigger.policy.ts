import { parseExpression } from 'cron-parser';
import { definitionRecord } from '@/common/automation/definition.types';
import { normalizeDataSchema } from '@/common/automation/data-schema';
import type {
  TriggerConfiguration,
  TriggerDefinition,
} from '../contract/trigger.types';

/**
 * 规范化触发器并校验时区、绝对时间和触发频率，不执行或推迟任何任务。
 * @param input - 待保存的触发器配置。
 * @returns 可以持久化并交给现有队列的触发器。
 * @throws 类型、表达式、时区、间隔或事件名非法时抛出校验错误。
 */
export function normalizeTriggerConfiguration(
  input: unknown,
): TriggerConfiguration {
  const value = definitionRecord(input);
  if (value.type === 'manual') return { type: 'manual' };
  if (value.type === 'cron') {
    const expression = String(value.expression || '')
      .trim()
      .replace(/\s+/g, ' ');
    const timezone = String(value.timezone || 'Asia/Shanghai');
    if (
      expression.split(' ').length !== 5 ||
      expression.length > 64 ||
      !/^[\d*/ ,\-]+$/.test(expression)
    ) {
      throw new Error('Cron 必须是合法的五段表达式');
    }
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    parseExpression(expression, { tz: timezone }).next();
    return { type: 'cron', expression, timezone };
  }
  if (value.type === 'interval') {
    const everyMs = value.everyMs;
    if (
      typeof everyMs !== 'number' ||
      !Number.isInteger(everyMs) ||
      everyMs < 1000 ||
      everyMs > 30 * 86400000
    ) {
      throw new Error('间隔必须是 1 秒至 30 天的整数毫秒');
    }
    return { type: 'interval', everyMs };
  }
  if (value.type === 'once') {
    const at = String(value.at || '');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
        at,
      ) ||
      !Number.isFinite(Date.parse(at))
    ) {
      throw new Error('一次性任务时间必须包含明确时区');
    }
    return { type: 'once', at: new Date(at).toISOString() };
  }
  if (value.type === 'event') {
    const eventKey = String(value.eventKey || '');
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(eventKey))
      throw new Error('事件名不符合任务契约');
    if (
      !Number.isSafeInteger(value.eventVersion) ||
      Number(value.eventVersion) < 1
    )
      throw new Error('必须选择明确的事件源版本');
    return {
      type: 'event',
      eventKey,
      eventVersion: Number(value.eventVersion),
      payloadSchema: normalizeDataSchema(value.payloadSchema),
    };
  }
  throw new Error('未知的任务触发器类型');
}

/**
 * 按触发器和时区计算下次运行时间；事件、手动及已过期单次任务返回空值。
 * @param trigger - 已规范化的触发器。
 * @param now - 本次计算的时间基准。
 * @returns 下次时间；事件、手动或已过期的一次性任务返回空值。
 */
export function nextTriggerAt(
  trigger: TriggerConfiguration,
  now = new Date(),
): Date | null {
  if (trigger.type === 'cron')
    return parseExpression(trigger.expression, {
      currentDate: now,
      tz: trigger.timezone,
    })
      .next()
      .toDate();
  if (trigger.type === 'interval')
    return new Date(now.getTime() + trigger.everyMs);
  if (trigger.type === 'once') {
    const at = new Date(trigger.at);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

/**
 * 校验触发定义的结构版本，触发器只描述发生条件而不包含执行目标。
 * @param input - 当前触发器资源的草稿。
 * @returns 可保存为独立发布版本的触发器。
 * @throws 结构版本或触发配置非法时拒绝保存。
 */
export function normalizeTriggerDefinition(input: unknown): TriggerDefinition {
  const value = definitionRecord(input);
  if (value.schemaVersion !== 1) throw new Error('触发器结构版本不支持');
  return {
    schemaVersion: 1,
    trigger: normalizeTriggerConfiguration(value.trigger),
  };
}
