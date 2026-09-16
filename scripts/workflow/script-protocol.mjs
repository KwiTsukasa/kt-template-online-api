export const SCRIPT_PROTOCOL = 'kt.workflow.script.v1';
const commonKeys = [
  'protocol',
  'kind',
  'executionId',
  'scriptSha256',
  'sequence',
];

/**
 * 验证普通 JSON 对象及封闭字段集合，业务字段只能进入显式扩展对象。
 * @param value - 待验证的对象。
 * @param keys - 允许的全部顶层字段。
 * @throws 对象形状或字段集合不符合固定协议时拒绝解析。
 */
function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('workflow-script-protocol-fields-invalid');
}

/**
 * 检查业务扩展区为有界 JSON 对象，禁止原型键和非有限数值。
 * @param value - 仅允许出现在 params 或 data 中的业务字段对象。
 * @returns 已隔离的 JSON 数据对象。
 * @throws 业务对象非法或超出一 MiB 限制时拒绝解析。
 */
export function businessData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('workflow-script-business-data-invalid');
  const json = JSON.stringify(value, (key, item) => {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    )
      throw new Error('workflow-script-business-data-invalid');
    return item;
  });
  if (Buffer.byteLength(json) > 1024 * 1024)
    throw new Error('workflow-script-business-data-too-large');
  return JSON.parse(json);
}

/**
 * 校验单条标准输出事件，严格绑定当前尝试、脚本摘要和递增序号。
 * @param value - 从一行标准输出解析的 JSON。
 * @param identity - 本次脚本运行的权威身份和上一事件序号。
 * @returns 已验证的进度事件或终态事件。
 * @throws 未实现标准协议、身份不匹配或向标准层添加业务字段时拒绝结果。
 */
export function parseScriptEvent(value, identity) {
  if (
    !value ||
    value.protocol !== SCRIPT_PROTOCOL ||
    value.executionId !== identity.executionId ||
    value.scriptSha256 !== identity.scriptSha256 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence !== identity.sequence + 1
  )
    throw new Error('workflow-script-protocol-identity-invalid');
  if (value.kind === 'progress') {
    exactKeys(value, [...commonKeys, 'progress', 'data']);
    exactKeys(value.progress, ['current', 'total', 'message']);
    const progress = value.progress;
    if (
      !Number.isSafeInteger(progress.current) ||
      !Number.isSafeInteger(progress.total) ||
      progress.current < 0 ||
      progress.total < 1 ||
      progress.current > progress.total ||
      typeof progress.message !== 'string' ||
      !progress.message.trim() ||
      progress.message.length > 2048
    )
      throw new Error('workflow-script-progress-invalid');
    return { ...value, data: businessData(value.data) };
  }
  if (value.kind !== 'result')
    throw new Error('workflow-script-event-kind-invalid');
  exactKeys(value, [...commonKeys, 'status', 'data', 'error']);
  if (!['succeeded', 'failed'].includes(value.status))
    throw new Error('workflow-script-result-status-invalid');
  if (value.status === 'succeeded' && value.error !== null)
    throw new Error('workflow-script-success-error-invalid');
  if (value.status === 'failed') {
    exactKeys(value.error, ['code', 'message']);
    if (
      typeof value.error.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.error.code) ||
      typeof value.error.message !== 'string' ||
      !value.error.message.trim() ||
      value.error.message.length > 2048
    )
      throw new Error('workflow-script-error-invalid');
  }
  return { ...value, data: businessData(value.data) };
}

/**
 * 固定脚本输入的标准层，业务参数集中在 params，前序脚本结果只提供受控 data 副本。
 * @param manifest - 工作流密封的脚本身份与业务上下文。
 * @returns 传给脚本标准输入的完整协议对象。
 */
export function scriptInput(manifest) {
  return {
    protocol: SCRIPT_PROTOCOL,
    executionId: manifest.executionId,
    scriptSha256: manifest.script.sha256,
    context: manifest.payload.context,
    params: businessData(manifest.payload.params),
    previous: manifest.payload.previous.map((result) => ({
      executionId: result.executionId,
      script: result.script,
      data: businessData(result.output),
    })),
  };
}
