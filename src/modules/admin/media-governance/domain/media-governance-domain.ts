import { posix } from 'node:path';

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

export type MediaGovernanceProfile =
  | 'embedded'
  | 'sidecar-bundled'
  | 'sidecar-linked';

export type MediaGovernanceSubtitleContractInput = {
  expectedEpisodeNumbers: number[];
  mappings: Array<{
    episodeNumber: number;
    releaseGroup: string;
  }>;
  releaseGroup?: string;
  seasonNumber: string;
  sourceId: string;
  sourceIds?: string[];
};

export type MediaGovernanceSubtitleContract =
  MediaGovernanceSubtitleContractInput & {
    releaseGroup: string;
  };

export class MediaGovernanceContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'MediaGovernanceContractError';
  }
}

/**
 * 使用稳定领域错误码中止机械治理合同校验。
 * @param code - 可供接口层映射的稳定错误码。
 * @throws 每次调用都抛出 `MediaGovernanceContractError`。
 */
function fail(code: string): never {
  throw new MediaGovernanceContractError(code);
}

/**
 * 校验 SHA-256 字符串并在格式漂移时失败关闭。
 * @param value - 待校验的小写十六进制摘要。
 * @param code - 摘要非法时使用的领域错误码。
 */
function assertSha256(value: string, code: string) {
  if (!/^[a-f\d]{64}$/u.test(value)) fail(code);
}

/**
 * 限制任务和来源标识的长度与字符集，阻止对象键越出受管命名空间。
 * @param value - 待校验的稳定标识。
 * @param code - 标识非法时使用的领域错误码。
 */
function assertIdentifier(value: string, code: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) fail(code);
}

/**
 * 按内容类型、来源角色与补充字幕前置任务校验机械治理分类。
 * @param input - 来源分类及可选关联任务状态。
 * @returns 主媒体对应的治理类型；补充字幕返回 `null`。
 */
export function assertSourceClassification(input: {
  contentKind: string;
  governanceProfile?: MediaGovernanceProfile | null;
  linkedTask: null | {
    contentKind: string;
    runState: string;
    stage: string;
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
 * 校验逐季字幕覆盖与发布组单一性并返回标准排序合同。
 * @param inputs - 每季期望集号和字幕文件映射。
 * @returns 按输入顺序排列且集号排序后的字幕合同。
 */
export function validateSubtitleContracts(
  inputs: MediaGovernanceSubtitleContractInput[],
): MediaGovernanceSubtitleContract[] {
  const seenSeasons = new Set<string>();
  return inputs.map((input) => {
    if (!/^S\d{2}$/u.test(input.seasonNumber)) {
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
    const releaseGroup = [...releaseGroups][0];
    if (!releaseGroup) fail('subtitle-season-mixed-release-group');
    return {
      ...input,
      expectedEpisodeNumbers: expected,
      mappings: [...input.mappings].sort(
        (left, right) => left.episodeNumber - right.episodeNumber,
      ),
      releaseGroup,
    };
  });
}

/**
 * 将已校验的任务、来源、修订号和摘要投影为不可穿越的私有描述符对象键。
 * @param input - 任务、来源、修订号、摘要和传输类型。
 * @returns 不可越出任务命名空间的描述符对象键。
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
 * 规范化描述符文件相对路径并拒绝越界、符号链接和可执行项。
 * @param input - 清单路径、条目类型与可执行标志。
 * @returns 规范化后的安全相对路径。
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
