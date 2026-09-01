import { createHash } from 'node:crypto';

export const MEDIA_GOVERNANCE_EXECUTOR_ACTIONS = [
  'source.inspect',
  'source.probe-runtime',
  'source.download',
  'source.pause',
  'source.resume',
  'source.cleanup',
  'governance.preflight',
  'governance.plan',
  'governance.execute',
  'acceptance.verify',
  'canary.torrent',
  'canary.magnet',
] as const;

export type MediaGovernanceExecutorAction =
  (typeof MEDIA_GOVERNANCE_EXECUTOR_ACTIONS)[number];

export const MEDIA_GOVERNANCE_EXECUTOR_FLOW_ID = 'kt.admin.media-governance-v1';
export const MEDIA_GOVERNANCE_EXECUTION_ENVELOPE_SCHEMA =
  'media-governance-execution-envelope-v1';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const INFO_HASH_PATTERN = /^[a-f0-9]{40}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const REPLAY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

export type MediaGovernanceExecutionSourceContract = {
  descriptorGrantId: string;
  descriptorRevision: number;
  descriptorSha256: string;
  infoHash: string;
  manifestSha256: null | string;
  selectedBytes: number;
  selectedFileCount: number;
  selectedFileIndices: number[];
  sourceId: string;
  transportKind: 'magnet' | 'torrent';
};

export type MediaGovernanceExecutionPlanContract = {
  planGrantId: string;
  planSha256: string;
  schemaVersion: '1.2.0';
  strategy: 'embedded' | 'sidecar-bundled' | 'sidecar-linked';
};

export type MediaGovernanceExecutionEnvelopeInput = {
  action: MediaGovernanceExecutorAction;
  expiresAt: string;
  inputSnapshotSha256: string;
  plan?: MediaGovernanceExecutionPlanContract;
  replayKey: string;
  runId: string;
  sources?: MediaGovernanceExecutionSourceContract[];
  taskId: string;
  taskRevision: number;
  unitIds: string[];
};

/**
 * 将执行信封递归序列化为键顺序稳定的 JSON 文本。
 * @param value - 待判定是否满足将执行信封递归序列化为键顺序稳定的 JSON 文本约束的候选值。
 * @returns 满足将执行信封递归序列化为键顺序稳定的 JSON 文本约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 校验执行契约标识符，并使用字段标签生成稳定错误码。
 * @param value - 参与标识比较、格式化或输出的候选值。
 * @param label - 决定标识内容、边界或目标的 `label` 值。
 * @throws 当 `!ID_PATTERN.test(value)` 成立时拒绝当前输入并抛出 `Error`。
 */
function assertId(value: string, label: string) {
  if (!ID_PATTERN.test(value)) throw new Error(`${label}-invalid`);
}

/**
 * 校验可空 SHA-256 摘要，并使用字段标签生成稳定错误码。
 * @param value - 参与Digest比较、格式化或输出的候选值。
 * @param label - 决定Digest内容、边界或目标的 `label` 值。
 * @throws 当 `value !== null && !DIGEST_PATTERN.test(value)` 成立时拒绝当前输入并抛出 `Error`。
 */
function assertDigest(value: string | null, label: string) {
  if (value !== null && !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label}-invalid`);
  }
}

/**
 * 校验动作所需的来源集合，并返回文件索引已排序的密封副本。
 * @param action - 决定Sources内容、边界或目标的 `action` 值。
 * @param sources - 用于Sources的领域对象，包含 `length`、`0` 字段。
 * @returns Sources；没有可用结果或提前结束时为 `undefined`。
 * @throws 当 `sources !== undefined` 成立时拒绝当前输入并抛出 `Error`；当 `!sources || sources.length === 0 || sources.length > 16` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!['source.download', 'source.resume', 'acceptance.verify'].includes( ac…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!Number.isInteger(source.descriptorRevision) || source.descriptorRevisi…` 成立时拒绝当前输入并抛出 `Error`；当 `!INFO_HASH_PATTERN.test(source.infoHash)` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!Number.isSafeInteger(source.selectedBytes) || source.selectedBytes < 0` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!Number.isInteger(source.selectedFileCount) || source.selectedFileCount…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `source.selectedFileIndices.length !== source.selectedFileCount || sourc…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `new Set(source.selectedFileIndices).size !== source.selectedFileIndices…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `new Set(sources.map((source) => source.sourceId)).size !== sources.leng…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `(action === 'canary.torrent' && source.transportKind !== 'torrent') ||…` 成立时拒绝当前输入并抛出 `Error`。
 */
function validateSources(
  action: MediaGovernanceExecutorAction,
  sources: MediaGovernanceExecutionSourceContract[] | undefined,
) {
  const requiresSource =
    action.startsWith('source.') || action.startsWith('canary.');
  const acceptsSources = requiresSource || action === 'acceptance.verify';
  if (!acceptsSources) {
    if (sources !== undefined) throw new Error('source-contract-unexpected');
    return undefined;
  }
  if (action === 'acceptance.verify' && sources === undefined) return undefined;
  if (!sources || sources.length === 0 || sources.length > 16) {
    throw new Error('source-contract-required');
  }
  if (
    !['source.download', 'source.resume', 'acceptance.verify'].includes(
      action,
    ) &&
    sources.length !== 1
  ) {
    throw new Error('source-contract-count-invalid');
  }
  for (const source of sources) {
    assertId(source.sourceId, 'source-id');
    assertId(source.descriptorGrantId, 'descriptor-grant-id');
    if (
      !Number.isInteger(source.descriptorRevision) ||
      source.descriptorRevision < 1
    ) {
      throw new Error('descriptor-revision-invalid');
    }
    assertDigest(source.descriptorSha256, 'descriptor-sha256');
    assertDigest(source.manifestSha256, 'manifest-sha256');
    if (!INFO_HASH_PATTERN.test(source.infoHash)) {
      throw new Error('source-info-hash-invalid');
    }
    if (
      !Number.isSafeInteger(source.selectedBytes) ||
      source.selectedBytes < 0
    ) {
      throw new Error('selected-file-contract-invalid');
    }
    if (
      !Number.isInteger(source.selectedFileCount) ||
      source.selectedFileCount < 0 ||
      source.selectedFileCount > 20_000
    ) {
      throw new Error('selected-file-contract-invalid');
    }
    if (
      source.selectedFileIndices.length !== source.selectedFileCount ||
      source.selectedFileIndices.some(
        (index) => !Number.isInteger(index) || index < 0,
      )
    ) {
      throw new Error('selected-file-contract-invalid');
    }
    if (
      new Set(source.selectedFileIndices).size !==
      source.selectedFileIndices.length
    ) {
      throw new Error('selected-file-contract-invalid');
    }
  }
  if (
    new Set(sources.map((source) => source.sourceId)).size !== sources.length ||
    new Set(sources.map((source) => source.descriptorGrantId)).size !==
      sources.length
  ) {
    throw new Error('source-contract-duplicate');
  }
  const source = sources[0]!;
  if (
    (action === 'canary.torrent' && source.transportKind !== 'torrent') ||
    (action === 'canary.magnet' && source.transportKind !== 'magnet')
  ) {
    throw new Error('canary-transport-mismatch');
  }
  return sources.map((entry) => ({
    ...entry,
    selectedFileIndices: [...entry.selectedFileIndices].sort(
      (left, right) => left - right,
    ),
  }));
}

/**
 * 校验动作所需的治理计划，并返回与输入隔离的计划副本。
 * @param action - 决定Plan内容、边界或目标的 `action` 值。
 * @param plan - 用于Plan的领域对象，包含 `planGrantId`、`planSha256`、`schemaVersion`、`strategy` 字段。
 * @returns Plan；没有可用结果或提前结束时为 `undefined`。
 * @throws 当 `requiresPlan && !plan` 成立时拒绝当前输入并抛出 `Error`；当 `plan.schemaVersion !== '1.2.0'` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!['embedded', 'sidecar-bundled', 'sidecar-linked'].includes(plan.strate…` 成立时拒绝当前输入并抛出 `Error`。
 */
function validatePlan(
  action: MediaGovernanceExecutorAction,
  plan: MediaGovernanceExecutionPlanContract | undefined,
) {
  const requiresPlan = ['governance.execute', 'acceptance.verify'].includes(
    action,
  );
  if (requiresPlan && !plan) throw new Error('sealed-plan-required');
  if (!plan) return undefined;
  assertId(plan.planGrantId, 'plan-grant-id');
  assertDigest(plan.planSha256, 'plan-sha256');
  if (plan.schemaVersion !== '1.2.0') {
    throw new Error('plan-schema-invalid');
  }
  if (
    !['embedded', 'sidecar-bundled', 'sidecar-linked'].includes(plan.strategy)
  ) {
    throw new Error('plan-strategy-invalid');
  }
  return { ...plan };
}

/**
 * 校验执行输入并生成带稳定内容摘要的密封执行信封。
 * @param input - 用于执行输入并生成带稳定内容摘要的密封执行信封的结构化输入，包含 `action`、`taskId`、`runId`、`replayKey` 字段。
 * @returns 包含 `sealedInputSha256` 字段的执行输入并生成带稳定内容摘要的密封执行信封。
 * @throws 当 `!MEDIA_GOVERNANCE_EXECUTOR_ACTIONS.includes(input.action)` 成立时拒绝当前输入并抛出 `Error`；当 `!REPLAY_KEY_PATTERN.test(input.replayKey)` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!Number.isInteger(input.taskRevision) || input.taskRevision < 1` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt)…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `input.unitIds.length === 0 || input.unitIds.length > 100 || input.unitI…` 成立时拒绝当前输入并抛出 `Error`；
 */
export function buildMediaGovernanceExecutionEnvelope(
  input: MediaGovernanceExecutionEnvelopeInput,
) {
  if (!MEDIA_GOVERNANCE_EXECUTOR_ACTIONS.includes(input.action)) {
    throw new Error('executor-action-invalid');
  }
  assertId(input.taskId, 'task-id');
  assertId(input.runId, 'run-id');
  if (!REPLAY_KEY_PATTERN.test(input.replayKey)) {
    throw new Error('replay-key-invalid');
  }
  if (!Number.isInteger(input.taskRevision) || input.taskRevision < 1) {
    throw new Error('task-revision-invalid');
  }
  assertDigest(input.inputSnapshotSha256, 'input-snapshot-sha256');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt) ||
    !Number.isFinite(Date.parse(input.expiresAt))
  ) {
    throw new Error('expires-at-invalid');
  }
  if (
    input.unitIds.length === 0 ||
    input.unitIds.length > 100 ||
    input.unitIds.some((unitId) => !ID_PATTERN.test(unitId)) ||
    new Set(input.unitIds).size !== input.unitIds.length
  ) {
    throw new Error('unit-ids-invalid');
  }
  const sources = validateSources(input.action, input.sources);
  const plan = validatePlan(input.action, input.plan);
  const sealed: MediaGovernanceExecutionEnvelopeInput & {
    flowId: typeof MEDIA_GOVERNANCE_EXECUTOR_FLOW_ID;
    schemaVersion: typeof MEDIA_GOVERNANCE_EXECUTION_ENVELOPE_SCHEMA;
  } = {
    action: input.action,
    expiresAt: input.expiresAt,
    flowId: MEDIA_GOVERNANCE_EXECUTOR_FLOW_ID,
    inputSnapshotSha256: input.inputSnapshotSha256,
    replayKey: input.replayKey,
    runId: input.runId,
    schemaVersion: MEDIA_GOVERNANCE_EXECUTION_ENVELOPE_SCHEMA,
    taskId: input.taskId,
    taskRevision: input.taskRevision,
    unitIds: [...input.unitIds],
  };
  if (plan) sealed.plan = plan;
  if (sources) sealed.sources = sources;
  return {
    ...sealed,
    sealedInputSha256: createHash('sha256')
      .update(canonicalJson(sealed))
      .digest('hex'),
  };
}
