import { requireDefinition } from '@/common/automation/validation';
import { definitionRecord } from '@/common/automation/definition.types';
import { normalizeDataSchema } from '@/common/automation/data-schema';
import type { AtomicTaskDefinition } from '../contract/task-definition.types';

/**
 * 限制原子任务只配置处理器版本、期限和有界重试，不接收触发器、规则或流程图。
 * @param input - 原子任务草稿。
 * @returns 可发布的执行约束。
 * @throws 处理器身份或执行约束不合法时拒绝保存。
 */
export function normalizeAtomicTaskDefinition(
  input: unknown,
): AtomicTaskDefinition {
  const source = definitionRecord(input);
  const handler = definitionRecord(source.handler);
  const contract = definitionRecord(source.contract);
  requireDefinition(
    typeof contract.idempotent === 'boolean' &&
      typeof contract.ownerKind === 'string' &&
      /^[a-z][a-z0-9-]{1,31}$/.test(contract.ownerKind),
    '处理器契约不合法',
  );
  requireDefinition(
    source.schemaVersion === 1 &&
      typeof handler.key === 'string' &&
      /^[a-z][a-z0-9_.:-]{2,190}$/.test(handler.key) &&
      Number.isSafeInteger(handler.version) &&
      Number(handler.version) >= 1,
    '任务处理器身份或版本不合法',
  );
  for (const [key, minimum, maximum] of [
    ['timeoutMs', 1000, 3600000],
    ['maxAttempts', 1, 5],
    ['retryBackoffMs', 1000, 3600000],
  ] as const) {
    requireDefinition(
      Number.isSafeInteger(source[key]) &&
        Number(source[key]) >= minimum &&
        Number(source[key]) <= maximum,
      `${key} 超出允许范围`,
    );
  }
  const allowed = new Set([
    'schemaVersion',
    'handler',
    'contract',
    'timeoutMs',
    'maxAttempts',
    'retryBackoffMs',
  ]);
  requireDefinition(
    !Object.keys(source).some((key) => !allowed.has(key)),
    '原子任务不接受规则、触发器或流程配置',
  );
  return {
    schemaVersion: 1,
    handler: { key: handler.key, version: Number(handler.version) },
    contract: {
      inputSchema: normalizeDataSchema(contract.inputSchema),
      outputSchema: normalizeDataSchema(contract.outputSchema),
      idempotent: contract.idempotent,
      ownerKind: contract.ownerKind,
    },
    timeoutMs: Number(source.timeoutMs),
    maxAttempts: Number(source.maxAttempts),
    retryBackoffMs: Number(source.retryBackoffMs),
  };
}
