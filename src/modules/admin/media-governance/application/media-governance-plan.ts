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
  for (const file of payload.files) {
    const normalized = path.posix.normalize(file.path);
    if (
      !file.path.startsWith(`${taskRoot}/sources/${file.sourceId}/`) ||
      normalized !== file.path ||
      file.path.includes('\0') ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) {
      throw new Error('governance-payload-file-invalid');
    }
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
