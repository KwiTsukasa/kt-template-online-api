import { sha256Json } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import { buildAdminMediaGovernancePlan } from '../../../src/modules/admin/media-governance/media-governance-plan';
import type {
  MediaGovernancePayloadSeal,
  MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/media-governance.service';

describe('Admin media Schema 1.2.0 plan builder', () => {
  const task = {
    governanceProfile: 'sidecar-bundled',
    id: 'media-task-plan-fixture',
    mediaType: 'tv',
    providerRef: { provider: 'tmdb', providerId: '105476' },
    releaseYear: 2021,
    revision: 8,
    sources: [
      {
        id: 'media-source-plan-fixture',
        manifest: [
          {
            executable: false,
            index: 0,
            relativePath: '[Fixture] Special [01].mkv',
            sizeBytes: 1_024,
          },
          {
            executable: false,
            index: 1,
            relativePath: '[Fixture] Special [01].chs.ass',
            sizeBytes: 512,
          },
          {
            executable: false,
            index: 2,
            relativePath: '[Fixture][Fonts].7z',
            sizeBytes: 256,
          },
        ],
        selectedFileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'video',
            index: 0,
            language: null,
            unitId: 'media-unit-plan-s00',
          },
          {
            episodeNumber: 1,
            fileRole: 'subtitle',
            index: 1,
            language: 'zh-CN',
            unitId: 'media-unit-plan-s00',
          },
          {
            episodeNumber: null,
            fileRole: 'font',
            index: 2,
            language: null,
            unitId: 'media-unit-plan-s00',
          },
        ],
      },
    ],
    titleHint: '异世界迷宫黑心企业',
    units: [
      {
        expectedEpisodeNumbers: [1],
        id: 'media-unit-plan-s00',
        seasonNumber: 'S00',
        subtitleContract: {
          expectedEpisodeNumbers: [1],
          mappings: [{ episodeNumber: 1, relativePath: 'Show.S00E01.chs.ass' }],
          releaseGroup: 'Fixture',
          sourceId: 'media-source-plan-fixture',
        },
        unitKind: 'season',
      },
    ],
    workItemId: 'media-063',
  } as MediaGovernanceTask;
  const root = `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/media-source-plan-fixture`;
  const payload: MediaGovernancePayloadSeal = {
    evidenceSha256: 'e'.repeat(64),
    files: [
      {
        index: 0,
        mtimeMs: 1_786_000_000_000,
        path: `${root}/Show.S00E01.mkv`,
        relativePath: '[Fixture] Special [01].mkv',
        sha256: 'a'.repeat(64),
        sizeBytes: 1_024,
        sourceId: 'media-source-plan-fixture',
      },
      {
        index: 1,
        mtimeMs: 1_786_000_000_000,
        path: `${root}/Show.S00E01.chs.ass`,
        relativePath: '[Fixture] Special [01].chs.ass',
        sha256: 'b'.repeat(64),
        sizeBytes: 512,
        sourceId: 'media-source-plan-fixture',
      },
      {
        index: 2,
        mtimeMs: 1_786_000_000_000,
        path: `${root}/[Fixture][Fonts].7z`,
        relativePath: '[Fixture][Fonts].7z',
        sha256: 'c'.repeat(64),
        sizeBytes: 256,
        sourceId: 'media-source-plan-fixture',
      },
    ],
    runId: 'media-run-plan-fixture',
  };

  it('seals an exact local-only plan with S00 and matching subtitle names', () => {
    const plan = buildAdminMediaGovernancePlan(
      task,
      payload,
      new Date('2026-08-11T12:00:00.000Z'),
    );
    expect(plan).toMatchObject({
      execution: {
        phase: 'local-only',
        replayKey: `${task.id}:governance:r9`,
      },
      schemaVersion: '1.2.0',
      sealed: true,
      strategy: 'sidecar-bundled',
      workItemId: 'media-063',
    });
    expect(
      plan.manifests.local.forward.map((entry) => entry.targetPath),
    ).toEqual([
      '/vol2/1000/Media/movie/TV/异世界迷宫黑心企业 (2021) [tmdbid-105476]/Season 00/异世界迷宫黑心企业 - S00E01.mkv',
      '/vol2/1000/Media/movie/TV/异世界迷宫黑心企业 (2021) [tmdbid-105476]/Season 00/异世界迷宫黑心企业 - S00E01.zh-CN.ass',
      '/vol2/1000/Media/movie/TV/异世界迷宫黑心企业 (2021) [tmdbid-105476]/Season 00/extras/Fonts/[Fixture][Fonts].7z',
    ]);
    expect(plan.execution.manifestSha256.localForward).toBe(
      sha256Json(plan.manifests.local.forward),
    );
    expect(JSON.stringify(plan)).not.toMatch(/cloudTransport|passkey|tracker/i);
  });

  it('keeps movie targets inside the canonical Movies root', () => {
    const movieTask = {
      ...task,
      governanceProfile: 'embedded',
      id: 'media-task-movie-plan-fixture',
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '645440' },
      sources: [
        {
          id: 'media-source-movie-fixture',
          manifest: [
            {
              executable: false,
              index: 0,
              relativePath: 'Movie.mkv',
              sizeBytes: 2_048,
            },
          ],
          selectedFileMappings: [
            {
              episodeNumber: null,
              fileRole: 'video',
              index: 0,
              language: null,
              unitId: 'media-unit-plan-movie',
            },
          ],
        },
      ],
      titleHint: '少女☆歌剧 Revue Starlight 剧场版',
      units: [
        {
          expectedEpisodeNumbers: [],
          id: 'media-unit-plan-movie',
          seasonNumber: null,
          subtitleContract: null,
          unitKind: 'movie',
        },
      ],
      workItemId: 'media-064',
    } as MediaGovernanceTask;
    const movieRoot = `/vol2/1000/.kt-media-governance-staging/${movieTask.id}/sources/media-source-movie-fixture`;
    const moviePayload: MediaGovernancePayloadSeal = {
      evidenceSha256: 'f'.repeat(64),
      files: [
        {
          index: 0,
          mtimeMs: 1_786_000_000_000,
          path: `${movieRoot}/Movie.mkv`,
          relativePath: 'Movie.mkv',
          sha256: 'c'.repeat(64),
          sizeBytes: 2_048,
          sourceId: 'media-source-movie-fixture',
        },
      ],
      runId: 'media-run-movie-plan-fixture',
    };

    const plan = buildAdminMediaGovernancePlan(movieTask, moviePayload);

    expect(plan.manifests.local.forward[0]?.targetPath).toBe(
      '/vol2/1000/Media/movie/Movies/少女☆歌剧 Revue Starlight 剧场版 (2021) [tmdbid-645440]/少女☆歌剧 Revue Starlight 剧场版.mkv',
    );
  });

  it('fails closed on missing episode coverage and paths outside the task staging root', () => {
    expect(() =>
      buildAdminMediaGovernancePlan(task, {
        ...payload,
        files: payload.files.filter((file) => !file.path.endsWith('.mkv')),
      }),
    ).toThrow('governance-selected-file-coverage-incomplete');
    expect(() =>
      buildAdminMediaGovernancePlan(task, {
        ...payload,
        files: [
          { ...payload.files[0]!, path: '/vol2/1000/Media/movie/outside.mkv' },
        ],
      }),
    ).toThrow('governance-payload-file-invalid');
  });
});
