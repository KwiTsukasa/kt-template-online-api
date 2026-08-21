import * as path from 'node:path';
import { sha256Json } from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import type {
  MediaGovernancePayloadSeal,
  MediaGovernanceTask,
} from './media-governance.service';

const VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.ts',
  '.webm',
]);
const SUBTITLE_EXTENSIONS = new Set(['.ass', '.ssa', '.srt', '.sup', '.vtt']);
const LOCAL_MEDIA_ROOT = '/vol2/1000/Media';
const LOCAL_TARGET_ROOT = `${LOCAL_MEDIA_ROOT}/movie`;

type FileKind = 'asset' | 'subtitle' | 'video';

type LocalPlanOperation = {
  evidenceId: string;
  fileKind: FileKind;
  operation: 'move';
  sourcePath: string;
  subtitle?: Record<string, unknown>;
  targetPath: string;
};

type LocalSourceEvidence = {
  digest: string;
  evidenceId: string;
  evidenceMethod: string;
  fileKind: FileKind;
  mtimeMs: number;
  path: string;
  scope: string;
  size: number;
};

type CanonicalIdentityRebaseInput = {
  amendmentPlanSha256: string;
  previousPlanSha256: string;
  providerTitle: string;
  summary: string;
};

/**
 * 按声明的文件角色校验扩展名，并投影为治理计划文件类型。
 * @param value - 参与Mapped文件Kind比较、格式化或输出的候选值。
 * @param fileRole - 决定Mapped文件Kind内容、边界或目标的 `fileRole` 值。
 * @returns 当前状态对应的Mapped文件Kind，取值为 `'video'`、`'subtitle'`、`'asset'`。
 * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
 */
function assertMappedFileKind(
  value: string,
  fileRole: 'font' | 'subtitle' | 'video',
): FileKind {
  const extension = path.posix.extname(value).toLowerCase();
  if (fileRole === 'video' && VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (fileRole === 'subtitle' && SUBTITLE_EXTENSIONS.has(extension)) {
    return 'subtitle';
  }
  if (
    fileRole === 'font' &&
    ['.7z', '.otf', '.rar', '.ttf', '.woff', '.woff2', '.zip'].includes(
      extension,
    )
  ) {
    return 'asset';
  }
  throw new Error(`governance-file-role-mismatch:${extension || 'none'}`);
}

/**
 * 清理媒体标题中的路径字符和冗余空白，并限制目录名长度。
 * @param value - 参与安全边界Title比较、格式化或输出的候选值。
 * @returns 安全边界Title。
 * @throws 当 `!normalized || normalized.length > 160` 成立时拒绝当前输入并抛出 `Error`。
 */
function safeTitle(value: string) {
  const normalized = value
    .normalize('NFC')
    .replaceAll(/[\\/\0]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(/^\.+|\.+$/gu, '')
    .trim();
  if (!normalized || normalized.length > 160) {
    throw new Error('governance-title-invalid');
  }
  return normalized;
}

/**
 * 根据媒体类型、年份和资料源身份生成正式媒体根目录。
 * @param task - 用于根据媒体类型、年份和资料源身份生成正式媒体根目录的领域对象，包含 `titleHint`、`releaseYear`、`providerRef`、`mediaType` 字段。
 * @returns 按参数编码并拼接完成的根据媒体类型、年份和资料源身份生成正式媒体根目录。
 */
function titleRoot(task: MediaGovernanceTask) {
  const title = safeTitle(task.titleHint);
  let year = '';
  if (task.releaseYear) year = ` (${task.releaseYear})`;
  let provider = '';
  if (task.providerRef) {
    provider = ` [${task.providerRef.provider}id-${task.providerRef.providerId}]`;
  }
  let category = 'Movies';
  if (task.mediaType === 'tv') category = 'TV';
  return `${LOCAL_TARGET_ROOT}/${category}/${title}${year}${provider}`;
}

/**
 * 从已提交目标路径提取唯一作品根，拒绝跨作品或越过正式媒体分类根的计划。
 * @param mediaType - 决定电影目录或电视目录边界的媒体类型。
 * @param operations - 已提交计划中的本地正向移动操作。
 * @returns 全部目标共同所属的旧作品根目录。
 * @throws 当操作为空、目标越界或目标跨越多个作品根时抛出。
 */
function committedTitleRoot(
  mediaType: MediaGovernanceTask['mediaType'],
  operations: LocalPlanOperation[],
) {
  if (operations.length === 0) {
    throw new Error('governance-identity-rebase-operations-missing');
  }
  let category = 'Movies';
  if (mediaType === 'tv') category = 'TV';
  const categoryRoot = `${LOCAL_TARGET_ROOT}/${category}`;
  const roots = new Set<string>();
  for (const operation of operations) {
    const relative = path.posix.relative(categoryRoot, operation.targetPath);
    const parts = relative.split('/');
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('../') ||
      path.posix.isAbsolute(relative)
    ) {
      throw new Error('governance-identity-rebase-target-invalid');
    }
    if (parts.length < 2 || !parts[0]) {
      throw new Error('governance-identity-rebase-target-invalid');
    }
    roots.add(`${categoryRoot}/${parts[0]}`);
  }
  if (roots.size !== 1) {
    throw new Error('governance-identity-rebase-root-ambiguous');
  }
  return [...roots][0]!;
}

/**
 * 校验旧计划的本地清单与来源证据，并返回可用于身份重排的隔离副本。
 * @param plan - 已执行且仍作为任务密封事实的 Schema 1.2.0 计划。
 * @returns 已校验的正向操作、来源证据、执行配置和清单对象。
 * @throws 当计划结构、摘要、动作或证据对应关系不完整时抛出。
 */
function parseCommittedPlanForIdentityRebase(plan: Record<string, unknown>) {
  const execution = plan.execution as Record<string, unknown> | undefined;
  const manifests = plan.manifests as Record<string, unknown> | undefined;
  const local = manifests?.local as Record<string, unknown> | undefined;
  const forward = local?.forward;
  const sourceEvidence = plan.sourceEvidence;
  const cloudSidecarQuarantine = manifests?.cloudSidecarQuarantine as
    | Record<string, unknown>
    | undefined;
  const cloudVideo = manifests?.cloudVideo as
    | Record<string, unknown>
    | undefined;
  if (
    plan.schemaVersion !== '1.2.0' ||
    plan.sealed !== true ||
    execution?.phase !== 'local-only'
  ) {
    throw new Error('governance-identity-rebase-plan-invalid');
  }
  if (!Array.isArray(forward) || !Array.isArray(sourceEvidence)) {
    throw new Error('governance-identity-rebase-plan-invalid');
  }
  if (
    !Array.isArray(cloudSidecarQuarantine?.forward) ||
    !Array.isArray(cloudSidecarQuarantine.inverse) ||
    !Array.isArray(cloudVideo?.forward) ||
    !Array.isArray(cloudVideo.inverse)
  ) {
    throw new Error('governance-identity-rebase-plan-invalid');
  }
  const operations: LocalPlanOperation[] = [];
  const evidenceById = new Map<string, LocalSourceEvidence>();
  for (const value of sourceEvidence) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('governance-identity-rebase-evidence-invalid');
    }
    const evidence = value as LocalSourceEvidence;
    if (
      typeof evidence.evidenceId !== 'string' ||
      evidenceById.has(evidence.evidenceId) ||
      evidence.scope !== 'local' ||
      evidence.evidenceMethod !== 'sha256-full-v1'
    ) {
      throw new Error('governance-identity-rebase-evidence-invalid');
    }
    if (
      !/^[a-f0-9]{64}$/u.test(evidence.digest) ||
      !Number.isSafeInteger(evidence.size) ||
      evidence.size < 0
    ) {
      throw new Error('governance-identity-rebase-evidence-invalid');
    }
    if (!Number.isSafeInteger(evidence.mtimeMs) || evidence.mtimeMs <= 0) {
      throw new Error('governance-identity-rebase-evidence-invalid');
    }
    evidenceById.set(evidence.evidenceId, evidence);
  }
  for (const value of forward) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('governance-identity-rebase-operation-invalid');
    }
    const operation = value as LocalPlanOperation;
    const evidence = evidenceById.get(operation.evidenceId);
    if (
      operation.operation !== 'move' ||
      !['asset', 'subtitle', 'video'].includes(operation.fileKind) ||
      !evidence
    ) {
      throw new Error('governance-identity-rebase-operation-invalid');
    }
    if (
      !path.posix.isAbsolute(operation.sourcePath) ||
      !path.posix.isAbsolute(operation.targetPath)
    ) {
      throw new Error('governance-identity-rebase-operation-invalid');
    }
    if (
      path.posix.normalize(operation.sourcePath) !== operation.sourcePath ||
      path.posix.normalize(operation.targetPath) !== operation.targetPath
    ) {
      throw new Error('governance-identity-rebase-operation-invalid');
    }
    if (
      evidence.fileKind !== operation.fileKind ||
      evidence.path !== operation.sourcePath
    ) {
      throw new Error('governance-identity-rebase-operation-invalid');
    }
    operations.push(structuredClone(operation));
  }
  if (operations.length !== evidenceById.size) {
    throw new Error('governance-identity-rebase-evidence-coverage-invalid');
  }
  return {
    evidenceById,
    execution,
    manifests,
    operations,
  };
}

/**
 * 仅识别执行器支持的身份重排版本标记，不把其他计划结构误判为可执行转换。
 * @param plan - 待识别的任务密封计划。
 * @returns 计划携带 `canonical-identity-rebase-v1` 转换声明时为 `true`。
 */
export function isCanonicalIdentityRebasePlan(
  plan: null | Record<string, unknown>,
) {
  const transition = plan?.transition;
  if (!transition || typeof transition !== 'object') return false;
  if (Array.isArray(transition)) return false;
  return (
    (transition as Record<string, unknown>).kind ===
    'canonical-identity-rebase-v1'
  );
}

/**
 * 把已提交文件的旧规范目标转换为新来源，并按修正后的身份重封可逆本地计划。
 * @param task - 已投影新资料源身份、但尚未改变文件位置的媒体任务。
 * @param currentPlan - 文件已按其正向清单提交的现有 Schema 1.2.0 计划。
 * @param input - 绑定原计划、身份修正计划、资料源标题和操作摘要的重排输入。
 * @param now - 写入新计划密封时间的时间基准。
 * @returns 来源证据、正逆清单、身份和转换声明相互一致的新密封计划。
 * @throws 当旧计划摘要不符、旧目标跨作品、新旧作品根相同或重排目标碰撞时抛出。
 */
export function buildCanonicalIdentityRebasePlan(
  task: MediaGovernanceTask,
  currentPlan: Record<string, unknown>,
  input: CanonicalIdentityRebaseInput,
  now = new Date(),
) {
  if (
    sha256Json(currentPlan) !== input.previousPlanSha256 ||
    !/^[a-f0-9]{64}$/u.test(input.amendmentPlanSha256) ||
    !input.providerTitle.trim() ||
    !task.providerRef ||
    task.providerRef.provider !== 'tmdb'
  ) {
    throw new Error('governance-identity-rebase-input-invalid');
  }
  const parsed = parseCommittedPlanForIdentityRebase(currentPlan);
  const previousTitleRoot = committedTitleRoot(
    task.mediaType,
    parsed.operations,
  );
  const targetTitleRoot = titleRoot(task);
  if (previousTitleRoot === targetTitleRoot) {
    throw new Error('governance-identity-rebase-not-required');
  }
  const forward = parsed.operations.map((operation) => {
    const relative = path.posix.relative(
      previousTitleRoot,
      operation.targetPath,
    );
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('../') ||
      path.posix.isAbsolute(relative)
    ) {
      throw new Error('governance-identity-rebase-target-invalid');
    }
    return {
      ...operation,
      sourcePath: operation.targetPath,
      targetPath: `${targetTitleRoot}/${relative}`,
    };
  });
  if (
    new Set(forward.map((operation) => operation.targetPath.toLowerCase()))
      .size !== forward.length
  ) {
    throw new Error('governance-identity-rebase-target-collision');
  }
  const inverse = [...forward].reverse().map((operation) => ({
    ...operation,
    sourcePath: operation.targetPath,
    targetPath: operation.sourcePath,
  }));
  const localEvidence = forward.map((operation) => {
    const evidence = parsed.evidenceById.get(operation.evidenceId)!;
    return {
      ...evidence,
      path: operation.sourcePath,
    };
  });
  const cloudSidecarQuarantine = parsed.manifests
    .cloudSidecarQuarantine as Record<string, unknown>;
  const cloudVideo = parsed.manifests.cloudVideo as Record<string, unknown>;
  const manifests = {
    ...parsed.manifests,
    local: { forward, inverse },
  };
  const manifestSha256 = {
    cloudSidecarForward: sha256Json(cloudSidecarQuarantine.forward),
    cloudSidecarInverse: sha256Json(cloudSidecarQuarantine.inverse),
    cloudVideoForward: sha256Json(cloudVideo.forward),
    cloudVideoInverse: sha256Json(cloudVideo.inverse),
    localForward: sha256Json(forward),
    localInverse: sha256Json(inverse),
  };
  return {
    ...currentPlan,
    execution: {
      ...parsed.execution,
      allowlists: {
        localSourceRoot: previousTitleRoot,
        localTargetRoot: LOCAL_TARGET_ROOT,
      },
      manifestSha256,
      phase: 'local-only',
      replayKey: `${task.id}:canonical-identity-rebase:r${task.revision + 1}`,
    },
    identity: {
      mediaType: task.mediaType,
      providerRef: task.providerRef,
      providerTitle: input.providerTitle.trim(),
      releaseYear: task.releaseYear,
      title: task.titleHint,
    },
    manifests,
    sealedAt: now.toISOString(),
    sourceEvidence: localEvidence,
    targetAbsenceEvidence: [],
    transition: {
      amendmentPlanSha256: input.amendmentPlanSha256,
      kind: 'canonical-identity-rebase-v1',
      previousPlanSha256: input.previousPlanSha256,
      previousTitleRoot,
      summary: input.summary.trim(),
      targetTitleRoot,
    },
  };
}

/**
 * 校验任务身份、计划摘要与全部正式目标都指向同一个当前规范作品根。
 * @param task - 准备进入元数据或独立验收阶段的任务。
 * @throws 当密封计划摘要、身份或目标根与任务当前身份不一致时抛出。
 */
export function assertAdminMediaGovernancePlanCanonicalIdentity(
  task: MediaGovernanceTask,
) {
  const plan = task.sealedPlan;
  if (
    !plan ||
    !task.sealedPlanSha256 ||
    sha256Json(plan) !== task.sealedPlanSha256
  ) {
    throw new Error('governance-sealed-plan-digest-mismatch');
  }
  const identity = plan.identity as Record<string, unknown> | undefined;
  const providerRef = identity?.providerRef as
    | Record<string, unknown>
    | undefined;
  const manifests = plan.manifests as Record<string, unknown> | undefined;
  const local = manifests?.local as Record<string, unknown> | undefined;
  const forward = local?.forward;
  let providerMatches =
    task.providerRef === null &&
    (identity?.providerRef === null || identity?.providerRef === undefined);
  if (task.providerRef && providerRef) {
    providerMatches =
      providerRef.provider === task.providerRef.provider &&
      providerRef.providerId === task.providerRef.providerId;
  }
  if (plan.schemaVersion !== '1.2.0' || plan.sealed !== true || !identity) {
    throw new Error('governance-sealed-plan-identity-mismatch');
  }
  if (
    identity.mediaType !== task.mediaType ||
    identity.title !== task.titleHint ||
    identity.releaseYear !== task.releaseYear
  ) {
    throw new Error('governance-sealed-plan-identity-mismatch');
  }
  if (!providerMatches || !Array.isArray(forward) || forward.length === 0) {
    throw new Error('governance-sealed-plan-identity-mismatch');
  }
  const root = titleRoot(task);
  for (const value of forward) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('governance-sealed-plan-target-root-mismatch');
    }
    const targetPath = (value as Record<string, unknown>).targetPath;
    if (typeof targetPath !== 'string' || !targetPath.startsWith(`${root}/`)) {
      throw new Error('governance-sealed-plan-target-root-mismatch');
    }
  }
}

/**
 * 校验执行器回传的暂存区文件清单，并返回任务暂存根目录。
 * @param task - 用于载荷的领域对象，包含 `id` 字段。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `files`、`evidenceSha256` 字段。
 * @returns 载荷。
 * @throws 当 `payload.files.length === 0 || payload.files.length > 20_000 || !/^[a-f0…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!file.path.startsWith(`${taskRoot}/sources/${file.sourceId}/`) || norma…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || !Number.…` 成立时拒绝当前输入并抛出 `Error`。
 */
function assertPayload(
  task: MediaGovernanceTask,
  payload: MediaGovernancePayloadSeal,
) {
  const taskRoot = `/vol2/1000/.kt-media-governance-staging/${task.id}`;
  if (
    payload.files.length === 0 ||
    payload.files.length > 20_000 ||
    !/^[a-f0-9]{64}$/u.test(payload.evidenceSha256)
  ) {
    throw new Error('governance-payload-seal-invalid');
  }
  const payloadIdentities = new Set<string>();
  for (const file of payload.files) {
    const normalized = path.posix.normalize(file.path);
    const identity = `${file.sourceId}:${file.index}`;
    const source = task.sources.find(
      (candidate) => candidate.id === file.sourceId,
    );
    const manifestEntry = source?.manifest.find(
      (candidate) => candidate.index === file.index,
    );
    if (
      !file.path.startsWith(`${taskRoot}/sources/${file.sourceId}/`) ||
      file.path.includes('/.kt-shards/') ||
      normalized !== file.path ||
      file.path.includes('\0')
    ) {
      throw new Error('governance-payload-file-invalid');
    }
    if (
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      payloadIdentities.has(identity)
    ) {
      throw new Error('governance-payload-file-invalid');
    }
    if (
      !manifestEntry ||
      manifestEntry.relativePath !== file.relativePath ||
      manifestEntry.sizeBytes !== file.sizeBytes
    ) {
      throw new Error('governance-payload-file-invalid');
    }
    payloadIdentities.add(identity);
    if (
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 0 ||
      !Number.isSafeInteger(file.mtimeMs) ||
      file.mtimeMs <= 0
    ) {
      throw new Error('governance-payload-file-invalid');
    }
  }
  return taskRoot;
}

/**
 * 按治理单元声明核对电影或剧集的视频与字幕覆盖范围。
 * @param task - 用于按治理单元声明核对电影或剧集的视频与字幕覆盖范围的领域对象，包含 `mediaType`、`units`、`governanceProfile` 字段。
 * @param identities - 决定按治理单元声明核对电影或剧集的视频与字幕覆盖范围内容、边界或目标的 `identities` 值。
 * @throws 当 `identities.filter((entry) => entry.kind === 'video').length !== 1` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `identities.some( (entry) => entry.kind !== 'asset' && !declaredSeasons.…` 成立时拒绝当前输入并抛出 `Error`；当 `unit.seasonNumber === null` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `videos.size === 0` 成立时拒绝当前输入并抛出 `Error`；当 `videos.size !== unit.expectedEpisodeNumbers.length || unit.expectedEpis…` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `unit.expectedEpisodeNumbers.some((episode) => !subtitles.has(episode))` 成立时拒绝当前输入并抛出 `Error`。
 */
function validateCoverage(
  task: MediaGovernanceTask,
  identities: Array<{ episode: number; kind: FileKind; season: number }>,
) {
  if (task.mediaType !== 'tv') {
    if (identities.filter((entry) => entry.kind === 'video').length !== 1) {
      throw new Error('governance-movie-video-count-invalid');
    }
    return;
  }
  const declaredSeasons = new Set(
    task.units.map((unit) => Number(unit.seasonNumber?.slice(1))),
  );
  if (
    identities.some(
      (entry) => entry.kind !== 'asset' && !declaredSeasons.has(entry.season),
    )
  ) {
    throw new Error('governance-season-outside-declaration');
  }
  for (const unit of task.units) {
    if (unit.seasonNumber === null)
      throw new Error('governance-unit-season-missing');
    const season = Number(unit.seasonNumber.slice(1));
    const videos = new Set(
      identities
        .filter((entry) => entry.kind === 'video' && entry.season === season)
        .map((entry) => entry.episode),
    );
    if (unit.expectedEpisodeNumbers.length === 0) {
      if (videos.size === 0) {
        throw new Error(
          `governance-video-coverage-incomplete:${unit.seasonNumber}`,
        );
      }
    } else if (
      videos.size !== unit.expectedEpisodeNumbers.length ||
      unit.expectedEpisodeNumbers.some((episode) => !videos.has(episode))
    ) {
      throw new Error(
        `governance-video-coverage-incomplete:${unit.seasonNumber}`,
      );
    }
    if (task.governanceProfile !== 'embedded') {
      const subtitles = new Set(
        identities
          .filter(
            (entry) => entry.kind === 'subtitle' && entry.season === season,
          )
          .map((entry) => entry.episode),
      );
      if (
        unit.expectedEpisodeNumbers.some((episode) => !subtitles.has(episode))
      ) {
        throw new Error(
          `governance-subtitle-coverage-incomplete:${unit.seasonNumber}`,
        );
      }
    }
  }
}

/**
 * 从密封载荷生成可逆、本地限定且摘要稳定的媒体治理计划。
 * @param task - 用于从密封载荷生成可逆、本地限定且摘要稳定的媒体治理计划的领域对象，包含 `workItemId`、`governanceProfile`、`titleHint`、`sources` 字段。
 * @param payload - 待按当前协议校验并路由的事件载荷，包含 `files` 字段。
 * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `new Date()`。
 * @returns 包含 `execution`、`identity`、`manifests`、`schemaVersion`、`sealed` 字段的从密封载荷生成可逆、本地限定且摘要稳定的媒体治理计划。
 * @throws 当 `!task.workItemId || !/^media-\d{3}$/u.test(task.workItemId)` 成立时拒绝当前输入并抛出 `Error`；当 `!task.governanceProfile` 成立时拒绝当前输入并抛出 `Error`；
 *   当 `selectedMappingCount !== payload.files.length` 成立时拒绝当前输入并抛出 `Error`；当 `new Set(forward.map((item) => item.targetPath.toLowerCase())).size !==…` 成立时拒绝当前输入并抛出 `Error`。
 */
export function buildAdminMediaGovernancePlan(
  task: MediaGovernanceTask,
  payload: MediaGovernancePayloadSeal,
  now = new Date(),
) {
  if (!task.workItemId || !/^media-\d{3}$/u.test(task.workItemId)) {
    throw new Error('governance-work-item-required');
  }
  if (!task.governanceProfile) throw new Error('governance-profile-required');
  const stagingRoot = assertPayload(task, payload);
  const root = titleRoot(task);
  const title = safeTitle(task.titleHint);
  const identities = payload.files.map((file) => {
    const source = task.sources.find(
      (candidate) => candidate.id === file.sourceId,
    );
    const mapping = source?.selectedFileMappings.find(
      (candidate) => candidate.index === file.index,
    );
    const manifestEntry = source?.manifest.find(
      (candidate) => candidate.index === file.index,
    );
    let unit = null;
    if (mapping) {
      unit = task.units.find((candidate) => candidate.id === mapping.unitId);
    }
    if (
      !source ||
      !mapping ||
      !manifestEntry ||
      manifestEntry.relativePath !== file.relativePath ||
      !unit
    ) {
      throw new Error('governance-selected-file-mapping-missing');
    }
    const kind = assertMappedFileKind(file.path, mapping.fileRole);
    if (task.mediaType !== 'tv') {
      return {
        episode: 1,
        fileRole: mapping.fileRole,
        kind,
        language: mapping.language,
        season: 0,
      };
    }
    if (
      unit.seasonNumber === null ||
      (mapping.episodeNumber === null && kind !== 'asset')
    ) {
      throw new Error('governance-selected-file-episode-missing');
    }
    return {
      episode: mapping.episodeNumber ?? 0,
      fileRole: mapping.fileRole,
      kind,
      language: mapping.language,
      season: Number(unit.seasonNumber.slice(1)),
    };
  });
  const selectedMappingCount = task.sources.reduce(
    (total, source) => total + source.selectedFileMappings.length,
    0,
  );
  if (selectedMappingCount !== payload.files.length) {
    throw new Error('governance-selected-file-coverage-incomplete');
  }
  validateCoverage(task, identities);

  const forward = payload.files.map((file, index) => {
    const identity = identities[index]!;
    const extension = path.posix.extname(file.path).toLowerCase();
    const seasonEpisode = `S${String(identity.season).padStart(2, '0')}E${String(identity.episode).padStart(2, '0')}`;
    let directory = root;
    if (task.mediaType === 'tv') {
      directory = `${root}/Season ${String(identity.season).padStart(2, '0')}`;
    }
    let language = null;
    if (identity.kind === 'subtitle') language = identity.language;
    let base = title;
    if (task.mediaType === 'tv') base = `${title} - ${seasonEpisode}`;
    let targetPath: string;
    if (identity.fileRole === 'font') {
      targetPath = `${directory}/extras/Fonts/${path.posix.basename(file.relativePath)}`;
    } else {
      let languageSuffix = '';
      if (language) languageSuffix = `.${language}`;
      targetPath = `${directory}/${base}${languageSuffix}${extension}`;
    }
    const evidenceId = `admin-${identity.kind}-${String(index + 1).padStart(4, '0')}`;
    const operation = {
      evidenceId,
      fileKind: identity.kind,
      operation: 'move' as const,
      sourcePath: file.path,
      targetPath,
    };
    if (identity.kind !== 'subtitle') return operation;
    return {
      ...operation,
      subtitle: {
        episode: identity.episode,
        language,
        season: identity.season,
        sourceId: file.sourceId,
      },
    };
  });
  if (
    new Set(forward.map((item) => item.targetPath.toLowerCase())).size !==
    forward.length
  ) {
    throw new Error('governance-target-collision');
  }
  const inverse = [...forward].reverse().map((operation) => ({
    ...operation,
    sourcePath: operation.targetPath,
    targetPath: operation.sourcePath,
  }));
  const manifests = {
    cloudSidecarQuarantine: { forward: [], inverse: [] },
    cloudVideo: { forward: [], inverse: [] },
    local: { forward, inverse },
  };
  const sourceEvidence = payload.files.map((file, index) => ({
    digest: file.sha256,
    evidenceId: `admin-${identities[index]!.kind}-${String(index + 1).padStart(4, '0')}`,
    evidenceMethod: 'sha256-full-v1',
    fileKind: identities[index]!.kind,
    mtimeMs: file.mtimeMs,
    path: file.path,
    scope: 'local',
    size: file.sizeBytes,
  }));
  return {
    execution: {
      allowlists: {
        localSourceRoot: `${LOCAL_MEDIA_ROOT}/incoming`,
        localStagingRoot: stagingRoot,
        localTargetRoot: LOCAL_TARGET_ROOT,
      },
      manifestSha256: {
        cloudSidecarForward: sha256Json(
          manifests.cloudSidecarQuarantine.forward,
        ),
        cloudSidecarInverse: sha256Json(
          manifests.cloudSidecarQuarantine.inverse,
        ),
        cloudVideoForward: sha256Json(manifests.cloudVideo.forward),
        cloudVideoInverse: sha256Json(manifests.cloudVideo.inverse),
        localForward: sha256Json(manifests.local.forward),
        localInverse: sha256Json(manifests.local.inverse),
      },
      phase: 'local-only',
      replayKey: `${task.id}:governance:r${task.revision + 1}`,
    },
    identity: {
      mediaType: task.mediaType,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      title: task.titleHint,
    },
    manifests,
    schemaVersion: '1.2.0',
    sealed: true,
    sealedAt: now.toISOString(),
    sourceEvidence,
    strategy: task.governanceProfile,
    targetAbsenceEvidence: [],
    workItemId: task.workItemId,
  } as const;
}
