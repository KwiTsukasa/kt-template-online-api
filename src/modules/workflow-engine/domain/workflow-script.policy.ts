import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import {
  definitionInteger,
  requireDefinition,
  requireDefinitionKeys,
} from '@/common/automation/validation';
import {
  SCRIPT_CALL_FIELDS,
  SCRIPT_ERROR,
  SCRIPT_LIMITS,
} from '../constants/script';
import { normalizeWorkflowScriptReference } from './workflow-script-declaration.policy';
import { definitionRecord } from '@/common/automation/definition.types';
import type { WorkflowScriptCall } from '../contract/workflow-script.types';
import { normalizeBindings } from './workflow-value-binding.policy';

/**
 * 把脚本参数密封为有界普通 JSON，拒绝序列化会丢失或改变意义的值。
 * @param input - 业务准备的参数或脚本产生的结果。
 * @returns 与调用者隔离且可以持久化的对象。
 * @throws 非对象、非 JSON 值、循环结构或超过一 MiB 时拒绝保存。
 */
export function normalizeWorkflowPayload(
  input: unknown,
): Record<string, unknown> {
  definitionRecord(input);
  const json = JSON.stringify(input, (key, value: unknown) => {
    const invalidProperty = FORBIDDEN_OBJECT_KEYS.has(key);
    const invalidType = ['undefined', 'function', 'symbol', 'bigint'].includes(
      typeof value,
    );
    const invalidNumber = typeof value === 'number' && !Number.isFinite(value);
    requireDefinition(
      !invalidProperty && !invalidType && !invalidNumber,
      '工作流脚本参数必须是普通 JSON 值',
    );
    return value;
  });
  requireDefinition(
    Buffer.byteLength(json) <= SCRIPT_LIMITS.payloadBytes,
    '工作流脚本参数超过一 MiB',
  );
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * 保留工作流声明的脚本顺序并固定内容摘要，拒绝浏览器传入文件路径或自由命令。
 * @param input - 节点声明的有序脚本清单。
 * @returns 具有明确超时、次数和退避的脚本调用序列。
 * @throws 脚本身份、摘要、次数或时间范围非法时拒绝保存。
 */
export function normalizeWorkflowScripts(input: unknown): WorkflowScriptCall[] {
  requireDefinition(
    Array.isArray(input) && input.length <= SCRIPT_LIMITS.maxCalls,
    SCRIPT_ERROR.calls,
  );
  return input.map((raw) => {
    const script = definitionRecord(raw);
    requireDefinitionKeys(script, SCRIPT_CALL_FIELDS, SCRIPT_ERROR.callFields);
    return {
      ...normalizeWorkflowScriptReference(script),
      timeoutMs: definitionInteger(
        script.timeoutMs,
        SCRIPT_LIMITS.minTimeoutMs,
        SCRIPT_LIMITS.maxTimeoutMs,
        SCRIPT_ERROR.timeout,
      ),
      maxAttempts: definitionInteger(
        script.maxAttempts,
        1,
        SCRIPT_LIMITS.maxAttempts,
        SCRIPT_ERROR.attempts,
      ),
      retryBackoffMs: definitionInteger(
        script.retryBackoffMs,
        SCRIPT_LIMITS.minRetryMs,
        SCRIPT_LIMITS.maxRetryMs,
        SCRIPT_ERROR.retry,
      ),
      params: normalizeBindings(script.params),
    };
  });
}
