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
  'metadata.verify',
  'metadata.repair',
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
  metadataRepairAttempt?: number;
  plan?: MediaGovernanceExecutionPlanContract;
  replayKey: string;
  runId: string;
  sources?: MediaGovernanceExecutionSourceContract[];
  taskId: string;
  taskRevision: number;
  unitIds: string[];
};

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

function assertId(value: string, label: string) {
  if (!ID_PATTERN.test(value)) throw new Error(`${label}-invalid`);
}

function assertDigest(value: string | null, label: string) {
  if (value !== null && !DIGEST_PATTERN.test(value)) {
    throw new Error(`${label}-invalid`);
  }
}

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
      source.selectedBytes < 0 ||
      !Number.isInteger(source.selectedFileCount) ||
      source.selectedFileCount < 0 ||
      source.selectedFileCount > 20_000 ||
      source.selectedFileIndices.length !== source.selectedFileCount ||
      source.selectedFileIndices.some(
        (index) => !Number.isInteger(index) || index < 0,
      ) ||
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

function validatePlan(
  action: MediaGovernanceExecutorAction,
  plan: MediaGovernanceExecutionPlanContract | undefined,
) {
  const requiresPlan = [
    'governance.execute',
    'metadata.verify',
    'metadata.repair',
    'acceptance.verify',
  ].includes(action);
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
  if (
    (input.action === 'metadata.repair' &&
      (!Number.isInteger(input.metadataRepairAttempt) ||
        input.metadataRepairAttempt! < 1 ||
        input.metadataRepairAttempt! > 2)) ||
    (input.action !== 'metadata.repair' &&
      input.metadataRepairAttempt !== undefined)
  ) {
    throw new Error('metadata-repair-attempt-invalid');
  }
  const sealed = {
    action: input.action,
    expiresAt: input.expiresAt,
    flowId: MEDIA_GOVERNANCE_EXECUTOR_FLOW_ID,
    inputSnapshotSha256: input.inputSnapshotSha256,
    ...(input.metadataRepairAttempt !== undefined
      ? { metadataRepairAttempt: input.metadataRepairAttempt }
      : {}),
    ...(plan ? { plan } : {}),
    replayKey: input.replayKey,
    runId: input.runId,
    schemaVersion: MEDIA_GOVERNANCE_EXECUTION_ENVELOPE_SCHEMA,
    ...(sources ? { sources } : {}),
    taskId: input.taskId,
    taskRevision: input.taskRevision,
    unitIds: [...input.unitIds],
  };
  return {
    ...sealed,
    sealedInputSha256: createHash('sha256')
      .update(canonicalJson(sealed))
      .digest('hex'),
  };
}
