export const WORKFLOW_SCRIPT_PROTOCOL = 'kt.workflow.script.v1' as const;

export const SCRIPT_LIMITS = Object.freeze({
  sourceBytes: 256 * 1024,
  declarationBytes: 32 * 1024,
  payloadBytes: 1024 * 1024,
  controlEnvelopeBytes: 2 * 1024 * 1024,
  nameLength: 128,
  descriptionLength: 2048,
  minTimeoutMs: 1000,
  maxTimeoutMs: 24 * 86_400_000,
  minRetryMs: 1000,
  maxRetryMs: 3_600_000,
  maxAttempts: 5,
  maxCalls: 16,
  heartbeatTtlMs: 10_000,
  controlTimeoutMs: 30_000,
});

export const SCRIPT_PATTERN = Object.freeze({
  key: /^[a-z][a-z0-9.-]{2,63}$/,
  stepKey: /^[a-z][a-z0-9.-]{1,63}$/,
  sha256: /^[a-f0-9]{64}$/,
  filename: /^[^/\\\0]{1,120}\.(mjs|py|sh)$/i,
});

export const SCRIPT_DECLARATION_FIELDS: ReadonlySet<string> = new Set([
  'protocol',
  'key',
  'name',
  'description',
  'processKey',
  'stepKey',
  'maxTimeoutMs',
  'idempotent',
  'paramsSchema',
  'resultSchema',
  'defaults',
]);
export const SCRIPT_CALL_FIELDS: ReadonlySet<string> = new Set([
  'key',
  'version',
  'sha256',
  'timeoutMs',
  'maxAttempts',
  'retryBackoffMs',
  'params',
]);

export const SCRIPT_ERROR = Object.freeze({
  protocol: `脚本必须声明 ${WORKFLOW_SCRIPT_PROTOCOL} 标准输入输出协议`,
  identity: '脚本身份、版本或内容摘要无效',
  name: '脚本标识或名称无效',
  description: '脚本说明需要为 2048 字符以内的文本',
  scope: '脚本必须声明适用业务接口与步骤',
  idempotence: '脚本必须明确声明幂等性',
  timeout: '脚本超时需要 1 秒至 24 天',
  attempts: '脚本最多尝试 1 至 5 次',
  retry: '脚本重试间隔需要 1 秒至 1 小时',
  calls: '业务步骤最多声明 16 个有序脚本',
  callFields: '脚本调用只能保存固定脚本引用及执行策略',
  declarationFields: '标准声明存在未知字段，业务参数必须放入 paramsSchema',
  defaults: '脚本默认参数未声明',
});
