import { definitionRecord } from '@/common/automation/definition.types';
import type { WorkflowScriptCall } from '../contract/workflow-script.types';
import { normalizeBindings } from './workflow.policy';

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
    const invalidProperty = ['__proto__', 'constructor', 'prototype'].includes(key);
    const invalidType = ['undefined', 'function', 'symbol', 'bigint'].includes(typeof value);
    const invalidNumber = typeof value === 'number' && !Number.isFinite(value);
    if (invalidProperty || invalidType || invalidNumber)
      throw new Error('工作流脚本参数必须是普通 JSON 值');
    return value;
  });
  if (Buffer.byteLength(json) > 1024 * 1024)
    throw new Error('工作流脚本参数超过一 MiB');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * 保留工作流声明的脚本顺序并固定内容摘要，拒绝浏览器传入文件路径或自由命令。
 * @param input - 节点声明的有序脚本清单。
 * @returns 具有明确超时、次数和退避的脚本调用序列。
 * @throws 脚本身份、摘要、次数或时间范围非法时拒绝保存。
 */
export function normalizeWorkflowScripts(input: unknown): WorkflowScriptCall[] {
  if (!Array.isArray(input) || input.length > 16)
    throw new Error('业务步骤最多声明 16 个有序脚本');
  return input.map((raw) => {
    const script = definitionRecord(raw);
    if (
      Object.keys(script).some(
        (key) =>
          ![
            'key',
            'version',
            'sha256',
            'timeoutMs',
            'maxAttempts',
            'retryBackoffMs',
            'params',
          ].includes(key),
      )
    )
      throw new Error('脚本调用只能保存固定脚本引用及执行策略');
    const key = script.key, sha256 = script.sha256;
    const validIdentity = typeof key === 'string' && /^[a-z][a-z0-9.-]{2,63}$/.test(key);
    const validVersion = Number.isSafeInteger(script.version) && Number(script.version) >= 1;
    const validDigest = typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256);
    if (!validIdentity || !validVersion || !validDigest)
      throw new Error('脚本身份、版本或内容摘要无效');
    if (
      !Number.isSafeInteger(script.timeoutMs) ||
      Number(script.timeoutMs) < 1000 ||
      Number(script.timeoutMs) > 24 * 86400000
    )
      throw new Error('脚本超时需要 1 秒至 31 天');
    if (
      !Number.isSafeInteger(script.maxAttempts) ||
      Number(script.maxAttempts) < 1 ||
      Number(script.maxAttempts) > 5
    )
      throw new Error('脚本最多尝试 1 至 5 次');
    if (
      !Number.isSafeInteger(script.retryBackoffMs) ||
      Number(script.retryBackoffMs) < 1000 ||
      Number(script.retryBackoffMs) > 3600000
    )
      throw new Error('脚本重试间隔需要 1 秒至 1 小时');
    return {
      key,
      version: Number(script.version),
      sha256,
      timeoutMs: Number(script.timeoutMs),
      maxAttempts: Number(script.maxAttempts),
      retryBackoffMs: Number(script.retryBackoffMs),
      params: normalizeBindings(script.params),
    };
  });
}
