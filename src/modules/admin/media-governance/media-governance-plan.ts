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

function titleRoot(task: MediaGovernanceTask) {
  const title = safeTitle(task.titleHint);
  const year = task.releaseYear ? ` (${task.releaseYear})` : '';
  const provider = task.providerRef
    ? ` [${task.providerRef.provider}id-${task.providerRef.providerId}]`
    : '';
  const category = task.mediaType === 'tv' ? 'TV' : 'Movies';
  return `${LOCAL_TARGET_ROOT}/${category}/${title}${year}${provider}`;
}

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
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
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
    const unit = mapping
      ? task.units.find((candidate) => candidate.id === mapping.unitId)
      : null;
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
    const directory =
      task.mediaType === 'tv'
        ? `${root}/Season ${String(identity.season).padStart(2, '0')}`
        : root;
    const language = identity.kind === 'subtitle' ? identity.language : null;
    const base =
      task.mediaType === 'tv' ? `${title} - ${seasonEpisode}` : title;
    const targetPath =
      identity.fileRole === 'font'
        ? `${directory}/extras/Fonts/${path.posix.basename(file.relativePath)}`
        : `${directory}/${base}${language ? `.${language}` : ''}${extension}`;
    const evidenceId = `admin-${identity.kind}-${String(index + 1).padStart(4, '0')}`;
    return {
      evidenceId,
      fileKind: identity.kind,
      operation: 'move',
      sourcePath: file.path,
      ...(identity.kind === 'subtitle'
        ? {
            subtitle: {
              episode: identity.episode,
              language,
              season: identity.season,
              sourceId: file.sourceId,
            },
          }
        : {}),
      targetPath,
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
