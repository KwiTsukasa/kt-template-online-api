import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { LLM_CODEX_PERMISSION_PROFILE } from '@/apps/media-codex-agent-gateway/domain/llm-codex-runtime.contract';

export const MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS = [
  {
    contentKind: 'embedded_subtitle_media',
    governanceProfile: 'embedded',
    sourceRole: 'primary_media',
  },
  {
    contentKind: 'burned_in_subtitle_media',
    governanceProfile: 'embedded',
    sourceRole: 'primary_media',
  },
  {
    contentKind: 'bundled_sidecar_media',
    governanceProfile: 'sidecar-bundled',
    sourceRole: 'primary_media',
  },
  {
    contentKind: 'subtitleless_media',
    governanceProfile: 'sidecar-linked',
    sourceRole: 'primary_media',
  },
  {
    contentKind: 'sidecar_subtitle_package',
    governanceProfile: null,
    sourceRole: 'supplemental_subtitle',
  },
] as const;

export const MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS = [
  'media.identity.read',
  'media.manifest.read',
  'media.probe.read',
  'provider.metadata.read',
  'subtitle.contract.read',
  'evidence.read',
  'plan.submit.sealed',
] as const;

export const MEDIA_GOVERNANCE_METADATA_FIELDS = {
  A: [
    'identity.provider',
    'identity.providerId',
    'identity.mediaType',
    'identity.releaseYear',
    'mapping.seasonEpisode',
    'mapping.targetUnique',
    'file.playable',
    'stream.audioVideo',
    'path.canonical',
    'subtitle.coverage',
    'subtitle.releaseGroup',
    'subtitle.runtimeTimeline',
    'transaction.sealed',
    'fnos.association',
    'cleanup.staging',
    'cleanup.downloadOwner',
  ],
  B: [
    'metadata.local-nfo',
    'title.original',
    'title.episode',
    'summary.series',
    'summary.episode',
    'date.release',
    'date.season',
    'date.episode',
    'artwork.series',
    'artwork.season',
    'artwork.s00',
    'artwork.movie',
    'artwork.poster',
  ],
  C: [
    'credits.cast',
    'credits.director',
    'credits.writer',
    'company.production',
    'rating',
    'tag',
    'genre',
    'contentRating',
    'artwork.logo',
    'artwork.banner',
    'artwork.fanart',
    'trailer',
    'audio.commentary',
    'language.extra',
    'extras.description',
  ],
} as const;

export const MEDIA_GOVERNANCE_SCHEMA_FIELDS = {
  agentSession: [
    'taskId',
    'threadId',
    'currentUnitId',
    'policySha256',
    'capsuleSha256',
    'checkpointSha256',
    'status',
    'lastHeartbeatAt',
  ],
  descriptorRevision: [
    'sourceId',
    'revision',
    'objectId',
    'sha256',
    'infoHash',
    'bytes',
    'manifestSha256',
    'active',
    'tombstonedAt',
  ],
  event: [
    'eventId',
    'taskId',
    'runId',
    'sequence',
    'type',
    'observedAt',
    'stage',
    'runState',
    'summary',
  ],
  metadataException: [
    'unitId',
    'fieldPath',
    'tier',
    'reasonCode',
    'sourcesChecked',
    'attempts',
    'selectedFallback',
    'agentThreadId',
    'policyVersion',
    'taskRevision',
    'evidenceSha256',
  ],
  operatorDecision: [
    'taskId',
    'unitId',
    'candidateSnapshotSha256',
    'selectedCandidateId',
    'reason',
    'previousRevision',
    'nextRevision',
    'verificationRunId',
  ],
  outbox: [
    'id',
    'taskId',
    'idempotencyKey',
    'flowId',
    'sealedInputSha256',
    'attempts',
    'leaseUntil',
    'executionId',
  ],
  run: [
    'id',
    'taskId',
    'taskRevision',
    'action',
    'status',
    'replayKey',
    'inputSnapshotSha256',
    'planSha256',
    'runnerSha256',
    'progress',
    'startedAt',
    'finishedAt',
    'evidenceSha256',
  ],
  source: [
    'id',
    'taskId',
    'transportKind',
    'sourceRole',
    'contentKind',
    'descriptorRevision',
    'infoHash',
    'manifestSha256',
    'releaseGroup',
    'seasonNumbers',
    'sourceHealth',
    'sourceHealthReason',
  ],
  task: [
    'id',
    'workItemId',
    'titleHint',
    'mediaType',
    'releaseYear',
    'providerRef',
    'declaredUnitIds',
    'stage',
    'runState',
    'gateReason',
    'governanceProfile',
    'revision',
    'activeRunId',
    'inputSnapshotSha256',
    'sealedPlanSha256',
    'metadataIdentity',
    'closedMode',
    'closedAt',
  ],
  unit: [
    'id',
    'taskId',
    'unitKind',
    'seasonNumber',
    'expectedEpisodeNumbers',
    'subtitleContract',
    'metadataProjection',
    'localAcceptedAt',
    'evidenceSha256',
  ],
} as const;

export type MediaGovernanceContentKind =
  (typeof MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS)[number]['contentKind'];
export type MediaGovernanceSourceRole =
  (typeof MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS)[number]['sourceRole'];
export type MediaGovernanceProfile =
  | 'embedded'
  | 'sidecar-bundled'
  | 'sidecar-linked';
export type MediaGovernanceStage =
  | 'acceptance'
  | 'closed'
  | 'download'
  | 'governance'
  | 'intake'
  | 'metadata';
export type MediaGovernanceRunState =
  | 'blocked'
  | 'draft'
  | 'failed'
  | 'queued'
  | 'ready'
  | 'running'
  | 'succeeded';
export type MediaGovernanceRunnerAction =
  | 'acceptance.verify'
  | 'cleanup.download-owner'
  | 'governance.execute'
  | 'governance.plan'
  | 'governance.preflight'
  | 'metadata.repair'
  | 'metadata.verify'
  | 'source.download'
  | 'source.inspect'
  | 'source.probe-runtime';
export type MediaGovernanceSourceHealth =
  | 'degraded'
  | 'inconclusive'
  | 'probing'
  | 'unavailable'
  | 'unchecked'
  | 'viable';
export type MediaGovernanceSourceHealthReason =
  | 'download_stalled'
  | 'insufficient_throughput'
  | 'local_connectivity_degraded'
  | 'magnet_metadata_unavailable'
  | 'no_complete_peer'
  | 'partial_availability'
  | 'source_runtime_available'
  | 'source_runtime_unavailable'
  | 'tracker_auth_failed'
  | 'tracker_unreachable';

export interface MediaGovernanceTaskProjection {
  activeRunId: null | string;
  closedAt: null | string;
  closedMode: 'agent_verified' | 'automatic' | 'bounded_repair' | null;
  declaredUnitIds: string[];
  gateReason: null | string;
  governanceProfile: MediaGovernanceProfile | null;
  id: string;
  inputSnapshotSha256: string;
  mediaType: 'movie' | 'theatrical' | 'tv';
  metadataIdentity: null | {
    provider: 'bangumi' | 'tmdb' | 'tvdb';
    providerId: string;
  };
  providerRef: null | {
    provider: 'bangumi' | 'tmdb' | 'tvdb';
    providerId: string;
  };
  releaseYear: null | number;
  revision: number;
  runState: MediaGovernanceRunState;
  sealedPlanSha256: null | string;
  stage: MediaGovernanceStage;
  titleHint: string;
  workItemId: null | string;
}

export interface MediaGovernanceSubtitleMapping {
  episodeNumber: number;
  releaseGroup: string;
}

export interface MediaGovernanceSubtitleContractInput {
  expectedEpisodeNumbers: number[];
  mappings: MediaGovernanceSubtitleMapping[];
  seasonNumber: string;
  sourceId: string;
}

export interface MediaGovernanceSubtitleContract extends MediaGovernanceSubtitleContractInput {
  releaseGroup: string;
}

export interface MediaGovernanceUnitProjection {
  evidenceSha256: null | string;
  expectedEpisodeNumbers: number[];
  id: string;
  localAcceptedAt: null | string;
  metadataProjection: {
    missingA: string[];
    missingB: string[];
    missingC: string[];
    validBFallbacks: string[];
  };
  seasonNumber: null | string;
  subtitleContract: MediaGovernanceSubtitleContract | null;
  taskId: string;
  unitKind: 'movie' | 'season';
}

export interface MediaGovernanceRunProjection {
  action: MediaGovernanceRunnerAction;
  evidenceSha256: null | string;
  finishedAt: null | string;
  id: string;
  inputSnapshotSha256: string;
  planSha256: null | string;
  progress: {
    completedBytes: number;
    completedItems: number;
    totalBytes: number;
    totalItems: number;
  };
  replayKey: string;
  runnerSha256: string;
  startedAt: string;
  status: 'failed' | 'queued' | 'running' | 'succeeded';
  taskId: string;
  taskRevision: number;
}

export interface MediaGovernanceSourceProjection {
  contentKind: MediaGovernanceContentKind;
  descriptorRevision: number;
  id: string;
  infoHash: string;
  manifestSha256: string;
  releaseGroup: null | string;
  seasonNumbers: string[];
  sourceHealth: MediaGovernanceSourceHealth;
  sourceHealthReason: MediaGovernanceSourceHealthReason | null;
  sourceRole: MediaGovernanceSourceRole;
  taskId: string;
  transportKind: 'local' | 'magnet' | 'torrent';
}

export interface MediaGovernanceDescriptorRevision {
  active: boolean;
  bytes: number;
  infoHash: string;
  manifestSha256: string;
  objectId: string;
  revision: number;
  sha256: string;
  sourceId: string;
  tombstonedAt: null | string;
}

export interface MediaGovernanceSemanticEvent {
  eventId: string;
  observedAt: string;
  runId: null | string;
  runState: MediaGovernanceRunState;
  sequence: number;
  stage: MediaGovernanceStage;
  summary: string;
  taskId: string;
  type: string;
}

export interface MediaGovernanceAgentSessionProjection {
  capsuleSha256: string;
  checkpointSha256: string;
  currentUnitId: string;
  lastHeartbeatAt: string;
  policySha256: string;
  status: 'active' | 'blocked' | 'closed';
  taskId: string;
  threadId: string;
}

export interface MediaGovernanceMetadataExceptionInput {
  agentThreadId: string;
  attempts: string[];
  evidenceSha256: string;
  fieldPath: string;
  policyVersion: string;
  reasonCode: string;
  selectedFallback: string;
  sourcesChecked: string[];
  taskRevision: number;
  tier: 'A' | 'B' | 'C';
  unitId?: string;
}

export interface MediaGovernanceOperatorDecisionProjection {
  candidateSnapshotSha256: string;
  nextRevision: number;
  previousRevision: number;
  reason: string;
  selectedCandidateId: string;
  taskId: string;
  unitId: string;
  verificationRunId: string;
}

export interface MediaGovernanceOutboxProjection {
  attempts: number;
  executionId: null | string;
  flowId: string;
  id: string;
  idempotencyKey: string;
  leaseUntil: null | string;
  sealedInputSha256: string;
  taskId: string;
}

export interface MediaGovernanceAgentPolicy {
  allowedRoots: string[];
  allowedTools: string[];
  approvalPolicy: 'never';
  cleanCwd: string;
  permissionProfile: typeof LLM_CODEX_PERMISSION_PROFILE;
  policySha256: string;
  policyVersion: string;
}

export interface MediaGovernanceAgentCapsule {
  allowedRoots: string[];
  allowedTools: string[];
  capsuleSha256: string;
  cloudGate: boolean;
  currentStage: MediaGovernanceStage;
  manifestSha256: string;
  outputSchema: string;
  policySha256: string;
  policyVersion: string;
  taskId: string;
  taskRevision: number;
}

export interface MediaGovernanceDomainFixture {
  agentSession: MediaGovernanceAgentSessionProjection;
  capsule: MediaGovernanceAgentCapsule;
  descriptorRevision: MediaGovernanceDescriptorRevision;
  event: MediaGovernanceSemanticEvent;
  metadataException: MediaGovernanceMetadataExceptionInput;
  operatorDecision: MediaGovernanceOperatorDecisionProjection;
  outbox: MediaGovernanceOutboxProjection;
  policy: MediaGovernanceAgentPolicy;
  retention: {
    activeMayBeDeleted: boolean;
    closedEvidenceMayBeDeleted: boolean;
  };
  runs: MediaGovernanceRunProjection[];
  schemas: string[];
  source: MediaGovernanceSourceProjection;
  task: MediaGovernanceTaskProjection;
  units: MediaGovernanceUnitProjection[];
}

export class MediaGovernanceContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'MediaGovernanceContractError';
  }
}

/**
 * 使用稳定领域错误码中止当前合同校验。
 * @param code - `code` 作为 `MediaGovernanceContractError` 构造参数。
 * @throws 调用该拒绝函数时抛出 `MediaGovernanceContractError`。
 */
function fail(code: string): never {
  throw new MediaGovernanceContractError(code);
}

/**
 * 校验`value`、`code`是否满足小写十六进制 SHA-256 摘要约束，并拒绝不合法输入。
 * @param value - 参与小写十六进制 SHA-256 摘要比较、格式化或输出的候选值。
 * @param code - 决定小写十六进制 SHA-256 摘要内容、边界或目标的 `code` 值。
 */
function assertSha256(value: string, code: string) {
  if (!/^[a-f\d]{64}$/.test(value)) fail(code);
}

/**
 * 校验`value`、`code`是否满足领域对象可接受的有界标识符约束，并拒绝不合法输入。
 * @param value - 参与领域对象可接受的有界标识符比较、格式化或输出的候选值。
 * @param code - 决定领域对象可接受的有界标识符内容、边界或目标的 `code` 值。
 */
function assertIdentifier(value: string, code: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) fail(code);
}

/**
 * 按来源内容、文件角色、治理策略与补充字幕边界校验来源分类。
 * @param input - 用于按来源内容、文件角色、治理策略与补充字幕边界校验来源分类的结构化输入，包含 `contentKind`、`sourceRole`、`governanceProfile`、`linkedTask` 字段。
 * @returns 按来源内容、文件角色、治理策略与补充字幕边界校验来源分类。
 */
export function assertSourceClassification(input: {
  contentKind: string;
  governanceProfile?: MediaGovernanceProfile | null;
  linkedTask: null | {
    contentKind: string;
    runState: MediaGovernanceRunState;
    stage: MediaGovernanceStage;
  };
  sourceRole: string;
}): MediaGovernanceProfile | null {
  const classification = MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS.find(
    (candidate) => candidate.contentKind === input.contentKind,
  );
  if (!classification || classification.sourceRole !== input.sourceRole) {
    fail('source-classification-mismatch');
  }
  if (
    input.governanceProfile !== undefined &&
    input.governanceProfile !== classification.governanceProfile
  ) {
    fail('source-classification-mismatch');
  }
  if (classification.sourceRole === 'supplemental_subtitle') {
    if (
      !input.linkedTask ||
      input.linkedTask.contentKind !== 'subtitleless_media'
    ) {
      fail('supplemental-subtitle-task-required');
    }
    if (
      input.linkedTask.stage === 'closed' ||
      input.linkedTask.runState === 'succeeded'
    ) {
      fail('supplemental-subtitle-task-closed');
    }
  }
  return classification.governanceProfile;
}

/**
 * 校验逐季字幕覆盖与发布组单一性，并返回标准排序后的合同。
 * @param inputs - 决定SubtitleContracts内容、边界或目标的 `inputs` 值。
 * @returns 按输入顺序得到的SubtitleContracts列表；没有匹配项时为空数组。
 */
export function validateSubtitleContracts(
  inputs: MediaGovernanceSubtitleContractInput[],
): MediaGovernanceSubtitleContract[] {
  const seenSeasons = new Set<string>();
  return inputs.map((input) => {
    if (!/^S\d{2}$/.test(input.seasonNumber)) {
      fail('subtitle-season-number-invalid');
    }
    if (seenSeasons.has(input.seasonNumber)) {
      fail('subtitle-season-duplicated');
    }
    seenSeasons.add(input.seasonNumber);
    const expected = [...new Set(input.expectedEpisodeNumbers)].sort(
      (left, right) => left - right,
    );
    const mapped = [
      ...new Set(input.mappings.map((item) => item.episodeNumber)),
    ].sort((left, right) => left - right);
    if (
      expected.length === 0 ||
      expected.length !== mapped.length ||
      expected.some((episode, index) => episode !== mapped[index])
    ) {
      fail('subtitle-season-coverage-incomplete');
    }
    const releaseGroups = new Set(
      input.mappings.map((item) => item.releaseGroup.trim()).filter(Boolean),
    );
    if (releaseGroups.size !== 1) {
      fail('subtitle-season-mixed-release-group');
    }
    return {
      ...input,
      expectedEpisodeNumbers: expected,
      mappings: [...input.mappings].sort(
        (left, right) => left.episodeNumber - right.episodeNumber,
      ),
      releaseGroup: [...releaseGroups][0],
    };
  });
}

/**
 * 按参数 `input`，校验描述符身份后生成私有对象存储键。
 * @param input - 用于按参数 `input`，校验描述符身份后生成私有对象存储键的结构化输入，包含 `taskId`、`sourceId`、`descriptorSha256`、`descriptorRevision` 字段。
 * @returns 按参数编码并拼接完成的按参数 `input`，校验描述符身份后生成私有对象存储键。
 */
export function buildDescriptorObjectKey(input: {
  descriptorRevision: number;
  descriptorSha256: string;
  sourceId: string;
  taskId: string;
  transportKind: 'magnet' | 'torrent';
}) {
  assertIdentifier(input.taskId, 'descriptor-task-id-invalid');
  assertIdentifier(input.sourceId, 'descriptor-source-id-invalid');
  assertSha256(input.descriptorSha256, 'descriptor-sha256-invalid');
  if (
    !Number.isSafeInteger(input.descriptorRevision) ||
    input.descriptorRevision < 1
  ) {
    fail('descriptor-revision-invalid');
  }
  let extension = 'magnet';
  if (input.transportKind === 'torrent') extension = 'torrent';
  return `tasks/${input.taskId}/sources/${input.sourceId}/revisions/${input.descriptorRevision}-${input.descriptorSha256}.${extension}`;
}

/**
 * 规范化描述符清单路径，并拒绝越界、符号链接和可执行项。
 * @param input - 用于描述信息清单表格条目的结构化输入，包含 `relativePath`、`entryType`、`executable` 字段。
 * @returns 描述信息清单表格条目。
 */
export function validateDescriptorManifestEntry(input: {
  entryType: 'file' | 'symbolic-link';
  executable: boolean;
  relativePath: string;
}) {
  const segments = input.relativePath.split('/');
  const normalized = posix.normalize(input.relativePath);
  if (
    !input.relativePath ||
    input.relativePath.includes('\0') ||
    input.relativePath.includes('\\') ||
    posix.isAbsolute(input.relativePath)
  ) {
    fail('descriptor-manifest-path-unsafe');
  }
  if (
    segments.includes('..') ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    input.entryType !== 'file' ||
    input.executable
  ) {
    fail('descriptor-manifest-path-unsafe');
  }
  return normalized;
}

/**
 * 规范化媒体路径，并确保其位于声明的允许根目录内。
 * @param input - 用于许可范围媒体任务路径的结构化输入，包含 `symbolicLink`、`candidate`、`allowedRoots` 字段。
 * @returns 许可范围媒体任务路径。
 */
export function assertAllowedMediaPath(input: {
  allowedRoots: string[];
  candidate: string;
  symbolicLink: boolean;
}) {
  if (input.symbolicLink) fail('symbolic-link-rejected');
  if (!posix.isAbsolute(input.candidate) || input.candidate.includes('\0')) {
    fail('path-outside-allowed-roots');
  }
  if (input.candidate.split('/').includes('..')) {
    fail('path-traversal-rejected');
  }
  const candidate = posix.normalize(input.candidate);
  const allowed = input.allowedRoots.some((root) => {
    const normalizedRoot = posix.normalize(root).replace(/\/$/, '');
    return (
      candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`)
    );
  });
  if (!allowed) fail('path-outside-allowed-roots');
  return candidate;
}

/**
 * 根据连通性、吞吐、可用度和 Tracker 状态判定来源健康度。
 * @param input - 用于根据连通性、吞吐、可用度和 Tracker 状态判定来源健康度的结构化输入，包含 `localConnectivityHealthy`、`bytesDelta`、`elapsedSeconds`、`selectedBytes` 字段。
 * @returns 包含 `health`、`reason` 字段的根据连通性、吞吐、可用度和 Tracker 状态判定来源健康度；无法解析或未命中时为 `null`。
 */
export function decideSourceHealth(input: {
  bytesDelta: number;
  completePeerCount: number;
  elapsedSeconds: number;
  localConnectivityHealthy: boolean;
  metadataAvailable: boolean;
  selectedAvailability: null | number;
  selectedBytes: number;
  trackerFailure: 'auth' | 'unreachable' | null;
}): {
  health: MediaGovernanceSourceHealth;
  reason: MediaGovernanceSourceHealthReason | null;
} {
  if (!input.localConnectivityHealthy) {
    return {
      health: 'degraded',
      reason: 'local_connectivity_degraded',
    };
  }
  if (input.bytesDelta > 0) {
    if (input.elapsedSeconds < 180) {
      return { health: 'probing', reason: null };
    }
    const averageBytesPerSecond = input.bytesDelta / input.elapsedSeconds;
    const remainingBytes = Math.max(0, input.selectedBytes - input.bytesDelta);
    if (remainingBytes / averageBytesPerSecond > 24 * 60 * 60) {
      return { health: 'degraded', reason: 'insufficient_throughput' };
    }
    return { health: 'viable', reason: null };
  }
  if (input.elapsedSeconds < 180) {
    return { health: 'probing', reason: null };
  }
  if (!input.metadataAvailable) {
    return {
      health: 'unavailable',
      reason: 'magnet_metadata_unavailable',
    };
  }
  if (input.trackerFailure === 'auth') {
    return { health: 'unavailable', reason: 'tracker_auth_failed' };
  }
  if (input.trackerFailure === 'unreachable') {
    return { health: 'unavailable', reason: 'tracker_unreachable' };
  }
  if (
    input.selectedAvailability !== null &&
    input.selectedAvailability > 0 &&
    input.selectedAvailability < 1
  ) {
    return { health: 'unavailable', reason: 'partial_availability' };
  }
  if (input.selectedAvailability === 0) {
    return { health: 'unavailable', reason: 'no_complete_peer' };
  }
  if (input.elapsedSeconds >= 600) {
    return {
      health: 'inconclusive',
      reason: 'source_runtime_unavailable',
    };
  }
  return { health: 'probing', reason: null };
}

/**
 * 按 B 级元数据例外协议核对理由、证据和回退上下文。
 * @param input - 用于按 B 级元数据例外协议核对理由、证据和回退上下文的结构化输入，包含 `tier`、`fieldPath`、`reasonCode`、`evidenceSha256` 字段。
 * @returns 按 B 级元数据例外协议核对理由、证据和回退上下文。
 */
export function validateMetadataException(
  input: MediaGovernanceMetadataExceptionInput,
) {
  if (input.tier === 'A') fail('metadata-a-tier-exception-forbidden');
  if (input.tier !== 'B') fail('metadata-exception-tier-invalid');
  if (
    !(MEDIA_GOVERNANCE_METADATA_FIELDS.B as readonly string[]).includes(
      input.fieldPath,
    )
  ) {
    fail('metadata-exception-field-not-b-tier');
  }
  if (
    !['localized_value_unavailable', 'season_artwork_not_published'].includes(
      input.reasonCode,
    )
  ) {
    fail('metadata-exception-reason-invalid');
  }
  assertSha256(input.evidenceSha256, 'metadata-exception-evidence-invalid');
  if (
    !input.fieldPath ||
    !input.reasonCode ||
    input.sourcesChecked.length === 0 ||
    input.attempts.length === 0
  ) {
    fail('metadata-exception-incomplete');
  }
  if (
    !input.selectedFallback ||
    !input.agentThreadId ||
    !input.policyVersion ||
    !Number.isSafeInteger(input.taskRevision)
  ) {
    fail('metadata-exception-incomplete');
  }
  return input;
}

/**
 * 将 A/B/C 级缺项与有效回退投影为元数据门禁状态。
 * @param input - 用于将 A/B/C 级缺项与有效回退投影为元数据门禁状态的结构化输入，包含 `missingA`、`missingB`、`missingC`、`validBFallbacks` 字段。
 * @returns 包含 `optionalMissing`、`status` 字段的将 A/B/C 级缺项与有效回退投影为元数据门禁状态。
 */
export function projectMetadataGate(input: {
  missingA: string[];
  missingB: string[];
  missingC: string[];
  validBFallbacks: string[];
}) {
  const tierFields = new Map<string, 'A' | 'B' | 'C'>();
  for (const tier of ['A', 'B', 'C'] as const) {
    for (const field of MEDIA_GOVERNANCE_METADATA_FIELDS[tier]) {
      tierFields.set(field, tier);
    }
  }
  for (const [tier, fields] of [
    ['A', input.missingA],
    ['B', input.missingB],
    ['C', input.missingC],
  ] as const) {
    if (fields.some((field) => tierFields.get(field) !== tier)) {
      fail('metadata-field-tier-mismatch');
    }
  }
  if (
    input.validBFallbacks.some(
      (field) =>
        !(MEDIA_GOVERNANCE_METADATA_FIELDS.B as readonly string[]).includes(
          field,
        ) || !input.missingB.includes(field),
    )
  ) {
    fail('metadata-fallback-invalid');
  }
  if (input.missingA.length > 0) {
    return {
      hardGateFailures: [...input.missingA].sort(),
      status: 'blocked' as const,
    };
  }
  const fallbacks = new Set(input.validBFallbacks);
  const unresolvedB = input.missingB.filter((field) => !fallbacks.has(field));
  if (unresolvedB.length > 0) {
    return {
      requiredDisplayMissing: unresolvedB.sort(),
      status: 'blocked' as const,
    };
  }
  if (input.missingB.length > 0) {
    return {
      fallbackCount: input.missingB.length,
      status: 'evidence-fallback' as const,
    };
  }
  return {
    optionalMissing: input.missingC.length,
    status: 'complete' as const,
  };
}

/**
 * 将受支持事件类型映射到 Redis、MySQL 和 NAS 证据保留策略。
 * @param type - 决定将受支持事件类型映射到 Redis、MySQL 和 NAS 证据保留策略内容、边界或目标的 `type` 值。
 * @returns 将受支持事件类型映射到 Redis、MySQL 和 NAS 证据保留策略。
 */
export function projectEventRetention(type: string) {
  const redisTypes = new Set([
    'agent-token-delta',
    'download-progress',
    'file-progress',
    'governance-progress',
    'peer-progress',
  ]);
  if (redisTypes.has(type)) {
    return { mysql: false, nasEvidence: true, redis: true };
  }
  const mysqlTypes = new Set([
    'agent-final-summary',
    'agent-thread-mapped',
    'gate-changed',
    'plan-sealed',
    'run-failed',
    'run-recovered',
    'snapshot-required',
    'source-health-concluded',
    'source-inspected',
    'state-transition',
    'task-closed',
    'transaction-committed',
    'transaction-rolled-back',
  ]);
  if (mysqlTypes.has(type)) {
    return { mysql: true, nasEvidence: true, redis: false };
  }
  return fail('event-type-unsupported');
}

/**
 * 根据任务年龄与证据状态投影运行热数据保留策略。
 * @param input - 用于根据任务年龄与证据状态投影运行热数据保留策略的结构化输入，包含 `closed`、`ageDays`、`evidenceSealed`、`evidenceShaVerified` 字段。
 * @returns 包含 `evidenceMayBeDeleted`、`hotMode`、`hotProgressMayBeDeleted` 字段的根据任务年龄与证据状态投影运行热数据保留策略。
 */
export function projectRunRetention(input: {
  ageDays: number;
  closed: boolean;
  evidenceSealed: boolean;
  evidenceShaVerified: boolean;
  hasActiveRun: boolean;
  hasRecovery: boolean;
}) {
  const mayDeleteHotProgress =
    input.closed &&
    input.ageDays >= 180 &&
    input.evidenceSealed &&
    input.evidenceShaVerified &&
    !input.hasActiveRun &&
    !input.hasRecovery;
  let hotMode: 'compressed-readonly' | 'hot' = 'hot';
  if (input.closed && input.ageDays >= 7) hotMode = 'compressed-readonly';
  return {
    evidenceMayBeDeleted: false,
    hotMode,
    hotProgressMayBeDeleted: mayDeleteHotProgress,
  };
}

/**
 * 从任务身份、动作、版本和输入摘要生成稳定幂等键。
 * @param input - 用于从任务身份、动作、版本和输入摘要生成稳定幂等键的结构化输入，包含 `inputSnapshotSha256`、`taskId`、`action`、`taskRevision` 字段。
 * @returns 从任务身份、动作、版本和输入摘要生成稳定幂等键。
 */
export function buildCommandIdempotencyKey(input: {
  action: MediaGovernanceRunnerAction;
  inputSnapshotSha256: string;
  taskId: string;
  taskRevision: number;
}) {
  assertSha256(input.inputSnapshotSha256, 'input-snapshot-sha-invalid');
  return createHash('sha256')
    .update(
      `${input.taskId}:${input.action}:${input.taskRevision}:${input.inputSnapshotSha256}`,
    )
    .digest('hex');
}

/**
 * 按证据类型与当前任务状态校验目标转换是否属于允许集合。
 * @param input - 用于按证据类型与当前任务状态校验目标转换是否属于允许集合的结构化输入，包含 `previous`、`next`、`evidenceType` 字段。
 * @returns 按证据类型与当前任务状态校验目标转换是否属于允许集合。
 */
export function assertWorkflowTransition(input: {
  evidenceType: string;
  next: {
    runState: MediaGovernanceRunState;
    stage: MediaGovernanceStage;
  };
  previous: {
    runState: MediaGovernanceRunState;
    stage: MediaGovernanceStage;
  };
}) {
  const transition = `${input.previous.stage}/${input.previous.runState}>${input.next.stage}/${input.next.runState}@${input.evidenceType}`;
  const allowed = new Set([
    'intake/draft>intake/ready@source-inspected',
    'intake/ready>download/queued@source-runtime-viable',
    'download/running>governance/ready@download-sealed',
    'governance/ready>governance/queued@plan-sealed',
    'governance/running>metadata/queued@transaction-committed',
    'metadata/running>acceptance/queued@metadata-valid',
    'metadata/running>metadata/blocked@metadata-repair-exhausted',
    'metadata/blocked>metadata/queued@agent-plan-sealed',
    'acceptance/running>closed/succeeded@task-accepted',
  ]);
  if (!allowed.has(transition)) fail('workflow-transition-invalid');
  return input.next;
}

/**
 * 按 Agent 策略核对胶囊身份、工具及媒体路径边界。
 * @param input - 用于按 Agent 策略核对胶囊身份、工具及媒体路径边界的结构化输入，包含 `units` 字段。
 * @returns 包含 `allowed` 字段的按 Agent 策略核对胶囊身份、工具及媒体路径边界。
 */
export function validateAgentBoundaryRequest(input: {
  capsule: MediaGovernanceAgentCapsule;
  policy: MediaGovernanceAgentPolicy;
  request: {
    instructionSource: string;
    paths: string[];
    requestsCloud: boolean;
    symbolicLinkPaths: string[];
    tool: string;
    untrustedContentPromotedToInstruction?: boolean;
  };
  task: MediaGovernanceTaskProjection;
  units: MediaGovernanceUnitProjection[];
}) {
  const { capsule, policy, request, task } = input;
  const stagingRoot = `/vol2/1000/.kt-media-governance-staging/${task.id}`;
  const evidenceRoot = '/vol1/docker/kt-codex/artifacts/automation/media/';
  if (policy.permissionProfile !== LLM_CODEX_PERMISSION_PROFILE) {
    fail('agent-policy-runtime-invalid');
  }
  if (
    policy.cleanCwd !== '/vol1/docker/kt-codex-agent/runtime' ||
    policy.allowedRoots.length === 0 ||
    policy.allowedRoots.some(
      (root) => root !== stagingRoot && !root.startsWith(evidenceRoot),
    ) ||
    capsule.allowedRoots.some((root) => !policy.allowedRoots.includes(root))
  ) {
    fail('agent-policy-root-invalid');
  }
  if (
    policy.allowedTools.some(
      (tool) =>
        !(MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS as readonly string[]).includes(
          tool,
        ),
    ) ||
    capsule.allowedTools.some((tool) => !policy.allowedTools.includes(tool))
  ) {
    fail('agent-policy-tool-invalid');
  }
  if (
    policy.approvalPolicy !== 'never' ||
    policy.policyVersion !== capsule.policyVersion ||
    policy.policySha256 !== capsule.policySha256 ||
    capsule.taskId !== task.id
  ) {
    fail('agent-capsule-identity-mismatch');
  }
  if (
    capsule.taskRevision !== task.revision ||
    capsule.currentStage !== task.stage ||
    capsule.manifestSha256 !== task.inputSnapshotSha256 ||
    capsule.outputSchema !== 'media-governance-agent-result-v1'
  ) {
    fail('agent-capsule-identity-mismatch');
  }
  if (
    !['operator-command', 'static-policy', 'task-capsule'].includes(
      request.instructionSource,
    ) ||
    request.untrustedContentPromotedToInstruction
  ) {
    fail('agent-instruction-source-untrusted');
  }
  if (
    !policy.allowedTools.includes(request.tool) ||
    !capsule.allowedTools.includes(request.tool)
  ) {
    fail('agent-tool-not-allowed');
  }
  for (const path of request.paths) {
    assertAllowedMediaPath({
      allowedRoots: policy.allowedRoots.filter((root) =>
        capsule.allowedRoots.includes(root),
      ),
      candidate: path,
      symbolicLink: request.symbolicLinkPaths.includes(path),
    });
  }
  if (request.requestsCloud) {
    if (!capsule.cloudGate) fail('cloud-gate-closed');
    if (input.units.some((unit) => unit.localAcceptedAt === null)) {
      fail('local-acceptance-incomplete');
    }
  }
  return { allowed: true as const };
}

/**
 * 根据当前领域状态，构造覆盖治理合同主要状态与边界的确定性领域夹具。
 * @returns 包含 `agentSession`、`capsule`、`descriptorRevision`、`event`、`metadataException` 字段的媒体任务治理任务DomainFixture。
 */
export function buildMediaGovernanceDomainFixture(): MediaGovernanceDomainFixture {
  const inputSnapshotSha256 = 'a'.repeat(64);
  const policySha256 = 'b'.repeat(64);
  const capsuleSha256 = 'c'.repeat(64);
  const evidenceSha256 = 'd'.repeat(64);
  const task: MediaGovernanceTaskProjection = {
    activeRunId: null,
    closedAt: null,
    closedMode: null,
    declaredUnitIds: ['media-unit-s00', 'media-unit-s01'],
    gateReason: null,
    governanceProfile: 'embedded',
    id: 'media-task-fixture',
    inputSnapshotSha256,
    mediaType: 'tv',
    metadataIdentity: null,
    providerRef: { provider: 'tmdb', providerId: '105476' },
    releaseYear: 2021,
    revision: 7,
    runState: 'ready',
    sealedPlanSha256: null,
    stage: 'governance',
    titleHint: '异世界迷宫黑心企业',
    workItemId: null,
  };
  const units: MediaGovernanceUnitProjection[] = [
    {
      evidenceSha256: null,
      expectedEpisodeNumbers: [1],
      id: 'media-unit-s00',
      localAcceptedAt: null,
      metadataProjection: {
        missingA: [],
        missingB: ['artwork.s00'],
        missingC: [],
        validBFallbacks: ['artwork.s00'],
      },
      seasonNumber: 'S00',
      subtitleContract: {
        expectedEpisodeNumbers: [1],
        mappings: [{ episodeNumber: 1, releaseGroup: 'DBD-Raws' }],
        releaseGroup: 'DBD-Raws',
        seasonNumber: 'S00',
        sourceId: 'media-source-fixture',
      },
      taskId: task.id,
      unitKind: 'season',
    },
    {
      evidenceSha256: null,
      expectedEpisodeNumbers: [1, 2],
      id: 'media-unit-s01',
      localAcceptedAt: null,
      metadataProjection: {
        missingA: [],
        missingB: [],
        missingC: ['artwork.fanart'],
        validBFallbacks: [],
      },
      seasonNumber: 'S01',
      subtitleContract: {
        expectedEpisodeNumbers: [1, 2],
        mappings: [
          { episodeNumber: 1, releaseGroup: 'DBD-Raws' },
          { episodeNumber: 2, releaseGroup: 'DBD-Raws' },
        ],
        releaseGroup: 'DBD-Raws',
        seasonNumber: 'S01',
        sourceId: 'media-source-fixture',
      },
      taskId: task.id,
      unitKind: 'season',
    },
  ];
  const policy: MediaGovernanceAgentPolicy = {
    allowedRoots: [
      '/vol2/1000/.kt-media-governance-staging/media-task-fixture',
      '/vol1/docker/kt-codex/artifacts/automation/media/media-run-fixture',
    ],
    allowedTools: [...MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS],
    approvalPolicy: 'never',
    cleanCwd: '/vol1/docker/kt-codex-agent/runtime',
    permissionProfile: LLM_CODEX_PERMISSION_PROFILE,
    policySha256,
    policyVersion: 'media-agent-policy-v2',
  };
  return {
    agentSession: {
      capsuleSha256,
      checkpointSha256: evidenceSha256,
      currentUnitId: units[0].id,
      lastHeartbeatAt: '2026-08-07T12:00:00.000Z',
      policySha256,
      status: 'blocked',
      taskId: task.id,
      threadId: 'media-agent-thread-fixture',
    },
    capsule: {
      allowedRoots: [...policy.allowedRoots],
      allowedTools: [...policy.allowedTools],
      capsuleSha256,
      cloudGate: false,
      currentStage: task.stage,
      manifestSha256: inputSnapshotSha256,
      outputSchema: 'media-governance-agent-result-v1',
      policySha256,
      policyVersion: policy.policyVersion,
      taskId: task.id,
      taskRevision: task.revision,
    },
    descriptorRevision: {
      active: true,
      bytes: 2048,
      infoHash: '1'.repeat(40),
      manifestSha256: inputSnapshotSha256,
      objectId: `tasks/${task.id}/sources/media-source-fixture/revisions/1-${evidenceSha256}.torrent`,
      revision: 1,
      sha256: evidenceSha256,
      sourceId: 'media-source-fixture',
      tombstonedAt: null,
    },
    event: {
      eventId: 'media-run-fixture:1',
      observedAt: '2026-08-07T12:00:00.000Z',
      runId: 'media-run-fixture',
      runState: 'succeeded',
      sequence: 1,
      stage: 'intake',
      summary: '来源清单已密封',
      taskId: task.id,
      type: 'source-inspected',
    },
    metadataException: {
      agentThreadId: 'media-agent-thread-fixture',
      attempts: ['TMDB 图片接口', 'TVDB 图片接口'],
      evidenceSha256,
      fieldPath: 'artwork.s00',
      policyVersion: policy.policyVersion,
      reasonCode: 'season_artwork_not_published',
      selectedFallback: '身份正确的作品海报',
      sourcesChecked: ['TMDB', 'TVDB'],
      taskRevision: task.revision,
      tier: 'B',
      unitId: units[0].id,
    },
    operatorDecision: {
      candidateSnapshotSha256: evidenceSha256,
      nextRevision: 8,
      previousRevision: 7,
      reason: '同名作品身份消歧',
      selectedCandidateId: 'tmdb:105476',
      taskId: task.id,
      unitId: units[1].id,
      verificationRunId: 'media-run-verify-fixture',
    },
    outbox: {
      attempts: 0,
      executionId: null,
      flowId: 'media-governance-flow-v1',
      id: 'media-outbox-fixture',
      idempotencyKey: buildCommandIdempotencyKey({
        action: 'governance.plan',
        inputSnapshotSha256,
        taskId: task.id,
        taskRevision: task.revision,
      }),
      leaseUntil: null,
      sealedInputSha256: inputSnapshotSha256,
      taskId: task.id,
    },
    policy,
    retention: {
      activeMayBeDeleted: projectRunRetention({
        ageDays: 1,
        closed: false,
        evidenceSealed: false,
        evidenceShaVerified: false,
        hasActiveRun: true,
        hasRecovery: false,
      }).hotProgressMayBeDeleted,
      closedEvidenceMayBeDeleted: projectRunRetention({
        ageDays: 365,
        closed: true,
        evidenceSealed: true,
        evidenceShaVerified: true,
        hasActiveRun: false,
        hasRecovery: false,
      }).evidenceMayBeDeleted,
    },
    runs: [
      {
        action: 'source.inspect',
        evidenceSha256,
        finishedAt: '2026-08-07T12:00:00.000Z',
        id: 'media-run-fixture',
        inputSnapshotSha256,
        planSha256: null,
        progress: {
          completedBytes: 2048,
          completedItems: 1,
          totalBytes: 2048,
          totalItems: 1,
        },
        replayKey: 'media-run-fixture-source-inspect',
        runnerSha256: 'e'.repeat(64),
        startedAt: '2026-08-07T11:59:00.000Z',
        status: 'succeeded',
        taskId: task.id,
        taskRevision: 6,
      },
    ],
    schemas: [
      'task',
      'unit',
      'run',
      'source',
      'descriptorRevision',
      'event',
      'agentSession',
      'metadataException',
      'operatorDecision',
      'outbox',
    ],
    source: {
      contentKind: 'embedded_subtitle_media',
      descriptorRevision: 1,
      id: 'media-source-fixture',
      infoHash: '1'.repeat(40),
      manifestSha256: inputSnapshotSha256,
      releaseGroup: 'DBD-Raws',
      seasonNumbers: ['S00', 'S01'],
      sourceHealth: 'viable',
      sourceHealthReason: null,
      sourceRole: 'primary_media',
      taskId: task.id,
      transportKind: 'torrent',
    },
    task,
    units,
  };
}
