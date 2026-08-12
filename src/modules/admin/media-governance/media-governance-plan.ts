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
const ASSET_EXTENSIONS = new Set(['.jpeg', '.jpg', '.nfo', '.png', '.webp']);
const LOCAL_MEDIA_ROOT = '/vol2/1000/Media';
const LOCAL_TARGET_ROOT = `${LOCAL_MEDIA_ROOT}/movie`;

type FileKind = 'asset' | 'subtitle' | 'video';

function fileKind(value: string): FileKind {
  const extension = path.posix.extname(value).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (SUBTITLE_EXTENSIONS.has(extension)) return 'subtitle';
  if (ASSET_EXTENSIONS.has(extension)) return 'asset';
  throw new Error(`unsupported-governance-file:${extension || 'none'}`);
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

function episodeIdentity(value: string) {
  const matches = [
    ...value.matchAll(/(?:^|[^A-Za-z0-9])S(\d{2})E(\d{1,3})(?!\d)/giu),
  ];
  if (matches.length !== 1)
    throw new Error('governance-episode-identity-ambiguous');
  return {
    episode: Number(matches[0]![2]),
    season: Number(matches[0]![1]),
  };
}

function subtitleLanguage(value: string) {
  const lower = value.toLowerCase();
  if (/(?:^|[._ -])(?:cht|tc|zh[-_.]?tw)(?:[._ -]|$)/u.test(lower))
    return 'zh-TW';
  if (/(?:^|[._ -])(?:chs|sc|zh[-_.]?(?:cn|hans))(?=[._ -]|$)/u.test(lower)) {
    return 'zh-CN';
  }
  if (/(?:^|[._ -])(?:jpn?|ja)(?:[._ -]|$)/u.test(lower)) return 'ja';
  if (/(?:^|[._ -])(?:eng?|en)(?:[._ -]|$)/u.test(lower)) return 'en';
  return 'zh-CN';
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
    const kind = fileKind(file.path);
    if (task.mediaType !== 'tv') return { episode: 1, kind, season: 0 };
    if (kind === 'asset') return { episode: 0, kind, season: 0 };
    return { ...episodeIdentity(file.relativePath), kind };
  });
  validateCoverage(task, identities);

  const forward = payload.files.map((file, index) => {
    const identity = identities[index]!;
    const extension = path.posix.extname(file.path).toLowerCase();
    const seasonEpisode = `S${String(identity.season).padStart(2, '0')}E${String(identity.episode).padStart(2, '0')}`;
    const directory =
      task.mediaType === 'tv'
        ? `${root}/Season ${String(identity.season).padStart(2, '0')}`
        : root;
    const language =
      identity.kind === 'subtitle' ? subtitleLanguage(file.relativePath) : null;
    const base =
      task.mediaType === 'tv' ? `${title} - ${seasonEpisode}` : title;
    const targetPath = `${directory}/${base}${language ? `.${language}` : ''}${extension}`;
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
