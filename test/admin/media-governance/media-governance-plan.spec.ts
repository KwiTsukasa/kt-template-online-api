import { sha256MediaGovernanceJson as sha256Json } from '../../../src/modules/admin/media-governance/contract/media-governance-hash';
import {
  buildAdminMediaGovernancePlan,
  buildCatalogIdentityRestorationPlan,
  buildCanonicalIdentityRebasePlan,
  buildMovieCanonicalReplacementPlan,
} from '../../../src/modules/admin/media-governance/application/media-governance-plan';
import { readMediaGovernanceCanonicalReplacement } from '../../../src/modules/admin/media-governance/contract/media-governance-plan.contract';
import type {
  MediaGovernancePayloadSeal,
  MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';

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

  it('keeps theatrical identity while using the canonical Movies root', () => {
    const movieTask = {
      ...task,
      governanceProfile: 'embedded',
      id: 'media-task-theatrical-plan-fixture',
      mediaType: 'theatrical',
      providerRef: { provider: 'bangumi', providerId: '604826' },
      releaseYear: 2026,
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
      titleHint: '超辉夜姬！',
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
    } as unknown as MediaGovernanceTask;
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
      '/vol2/1000/Media/movie/Movies/超辉夜姬！ (2026) [bangumiid-604826]/超辉夜姬！.mkv',
    );
    expect(plan.catalogIdentity).toMatchObject({
      mediaType: 'theatrical',
      providerRef: { provider: 'bangumi', providerId: '604826' },
    });
    expect(plan.identity).toMatchObject({
      mediaType: 'theatrical',
      providerRef: { provider: 'bangumi', providerId: '604826' },
    });
  });

  it('seals the existing canonical movie as the rollback identity of one upgrade candidate', () => {
    const targetPath =
      '/vol2/1000/Media/movie/Movies/蜘蛛侠：英雄归来 (2017) [bangumiid-178607]/蜘蛛侠：英雄归来.mkv';
    const candidatePlan = {
      execution: {
        replayKey: 'media-task-homecoming-remux:governance:r13',
      },
      manifests: {
        local: {
          forward: [
            {
              evidenceId: 'candidate-video',
              fileKind: 'video',
              operation: 'move',
              sourcePath:
                '/vol2/1000/.kt-media-governance-staging/media-task-homecoming-remux/Homecoming.REMUX.mkv',
              targetPath,
            },
          ],
        },
      },
      schemaVersion: '1.2.0',
      sealed: true,
      sealedAt: '2026-08-28T00:00:00.000Z',
      sourceEvidence: [
        {
          digest: 'a'.repeat(64),
          evidenceId: 'candidate-video',
          evidenceMethod: 'sha256-full-v1',
          fileKind: 'video',
          mtimeMs: 1_788_000_000_000,
          path: '/vol2/1000/.kt-media-governance-staging/media-task-homecoming-remux/Homecoming.REMUX.mkv',
          scope: 'local',
          size: 53_537_900_139,
        },
      ],
      workItemId: 'media-086',
    };
    const currentPlan = {
      execution: { replayKey: 'media-task-homecoming-current:governance:r20' },
      manifests: {
        local: {
          forward: [
            {
              evidenceId: 'current-video',
              fileKind: 'video',
              operation: 'move',
              sourcePath:
                '/vol2/1000/.kt-media-governance-staging/media-task-homecoming-current/Homecoming.mkv',
              targetPath,
            },
          ],
        },
      },
      schemaVersion: '1.2.0',
      sealed: true,
      sourceEvidence: [
        {
          digest: 'b'.repeat(64),
          evidenceId: 'current-video',
          evidenceMethod: 'sha256-full-v1',
          fileKind: 'video',
          mtimeMs: 1_787_000_000_000,
          path: '/vol2/1000/.kt-media-governance-staging/media-task-homecoming-current/Homecoming.mkv',
          scope: 'local',
          size: 5_385_907_675,
        },
      ],
      workItemId: 'media-082',
    };
    const candidate = {
      activeRunId: null,
      id: 'media-task-homecoming-remux',
      mediaType: 'movie',
      providerRef: { provider: 'bangumi', providerId: '178607' },
      releaseYear: 2017,
      revision: 13,
      sealedPlan: candidatePlan,
      sealedPlanSha256: sha256Json(candidatePlan),
      seriesId: 'media-series-homecoming',
      workId: 'media-work-homecoming',
    } as unknown as MediaGovernanceTask;
    const current = {
      activeRunId: null,
      closedAt: '2026-08-27T00:00:00.000Z',
      closedMode: 'bounded_repair',
      id: 'media-task-homecoming-current',
      mediaType: 'movie',
      providerRef: { provider: 'bangumi', providerId: '178607' },
      releaseYear: 2017,
      revision: 24,
      runState: 'succeeded',
      sealedPlan: currentPlan,
      sealedPlanSha256: sha256Json(currentPlan),
      seriesId: 'media-series-homecoming',
      stage: 'closed',
      units: [
        {
          evidenceSha256: 'e'.repeat(64),
          localAcceptedAt: '2026-08-29T01:00:00.000Z',
        },
      ],
      workId: 'media-work-homecoming',
      workItemId: 'media-082',
    } as unknown as MediaGovernanceTask;

    const replacementPlan = buildMovieCanonicalReplacementPlan(
      candidate,
      current,
      new Date('2026-08-30T01:00:00.000Z'),
    );
    const replacement =
      readMediaGovernanceCanonicalReplacement(replacementPlan);

    expect(replacementPlan.execution).toMatchObject({
      replayKey: 'media-task-homecoming-remux:governance:r14:replace',
    });
    expect(replacement).toMatchObject({
      replacedPlanSha256: current.sealedPlanSha256,
      replacedTaskId: current.id,
      replacedTaskRevision: 24,
      replacedWorkItemId: 'media-082',
      targetEvidence: {
        digest: 'b'.repeat(64),
        path: targetPath,
        size: 5_385_907_675,
      },
    });
    expect(replacementPlan.manifests).toEqual(candidatePlan.manifests);
  });

  it('rebases an already committed movie target after a late identity amendment', () => {
    const oldTask = {
      ...task,
      governanceProfile: 'embedded',
      id: 'media-task-jjk-zero-rebase',
      mediaType: 'movie',
      providerRef: null,
      releaseYear: null,
      sources: [
        {
          id: 'media-source-jjk-zero',
          manifest: [
            {
              executable: false,
              index: 0,
              relativePath: 'Jujutsu.Kaisen.0.mkv',
              sizeBytes: 2_048,
            },
          ],
          selectedFileMappings: [
            {
              episodeNumber: null,
              fileRole: 'video',
              index: 0,
              language: null,
              unitId: 'media-unit-jjk-zero',
            },
          ],
        },
      ],
      titleHint: '咒术回战0',
      units: [
        {
          expectedEpisodeNumbers: [],
          id: 'media-unit-jjk-zero',
          seasonNumber: null,
          subtitleContract: null,
          unitKind: 'movie',
        },
      ],
      workItemId: 'media-073',
    } as MediaGovernanceTask;
    const oldStagingRoot = `/vol2/1000/.kt-media-governance-staging/${oldTask.id}/sources/media-source-jjk-zero`;
    const oldPlan = buildAdminMediaGovernancePlan(oldTask, {
      evidenceSha256: 'f'.repeat(64),
      files: [
        {
          index: 0,
          mtimeMs: 1_786_000_000_000,
          path: `${oldStagingRoot}/Jujutsu.Kaisen.0.mkv`,
          relativePath: 'Jujutsu.Kaisen.0.mkv',
          sha256: 'd'.repeat(64),
          sizeBytes: 2_048,
          sourceId: 'media-source-jjk-zero',
        },
      ],
      runId: 'media-run-jjk-zero',
    });
    const amendedTask = {
      ...oldTask,
      providerRef: { provider: 'tmdb', providerId: '810693' },
      releaseYear: 2022,
    } as MediaGovernanceTask;
    const previousPlanSha256 = sha256Json(oldPlan);

    const rebased = buildCanonicalIdentityRebasePlan(
      amendedTask,
      oldPlan,
      {
        amendmentPlanSha256: 'e'.repeat(64),
        previousPlanSha256,
        providerTitle: '剧场版 咒术回战 0',
        summary: '将已提交的旧身份目录重排到 TMDB 规范根',
      },
      new Date('2026-08-17T12:00:00.000Z'),
    );

    const oldTarget = '/vol2/1000/Media/movie/Movies/咒术回战0/咒术回战0.mkv';
    const newTarget =
      '/vol2/1000/Media/movie/Movies/咒术回战0 (2022) [tmdbid-810693]/咒术回战0.mkv';
    expect(rebased).toMatchObject({
      execution: {
        allowlists: {
          localSourceRoot: '/vol2/1000/Media/movie/Movies/咒术回战0',
          localTargetRoot: '/vol2/1000/Media/movie',
        },
        phase: 'local-only',
        replayKey: `${oldTask.id}:canonical-identity-rebase:r9`,
      },
      identity: {
        mediaType: 'movie',
        providerRef: { provider: 'tmdb', providerId: '810693' },
        providerTitle: '剧场版 咒术回战 0',
        releaseYear: 2022,
        title: '咒术回战0',
      },
      transition: {
        amendmentPlanSha256: 'e'.repeat(64),
        kind: 'canonical-identity-rebase-v1',
        previousPlanSha256,
        previousTitleRoot: '/vol2/1000/Media/movie/Movies/咒术回战0',
        targetTitleRoot:
          '/vol2/1000/Media/movie/Movies/咒术回战0 (2022) [tmdbid-810693]',
      },
    });
    expect(rebased.execution.allowlists).not.toHaveProperty('localStagingRoot');
    expect(rebased.manifests.local.forward).toEqual([
      expect.objectContaining({ sourcePath: oldTarget, targetPath: newTarget }),
    ]);
    expect(rebased.manifests.local.inverse).toEqual([
      expect.objectContaining({ sourcePath: newTarget, targetPath: oldTarget }),
    ]);
    expect(rebased.sourceEvidence).toEqual([
      expect.objectContaining({
        digest: 'd'.repeat(64),
        mtimeMs: 1_786_000_000_000,
        path: oldTarget,
        size: 2_048,
      }),
    ]);
    expect(rebased.execution.manifestSha256.localForward).toBe(
      sha256Json(rebased.manifests.local.forward),
    );
    expect(rebased.execution.manifestSha256.localInverse).toBe(
      sha256Json(rebased.manifests.local.inverse),
    );
  });

  it('restores a legacy collapsed catalog identity without moving committed targets', () => {
    const catalogTask = {
      ...task,
      providerRef: { provider: 'bangumi', providerId: '302286' },
      releaseYear: 2022,
      titleHint: '死神 千年血战篇',
    } as MediaGovernanceTask;
    const explicitPlan = buildAdminMediaGovernancePlan(catalogTask, payload);
    const legacyPlan = structuredClone(explicitPlan) as unknown as Record<
      string,
      unknown
    >;
    delete legacyPlan.catalogIdentity;
    delete legacyPlan.metadataIdentity;
    const wrongTask = {
      ...catalogTask,
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '30984',
        releaseYear: 2004,
      },
      providerRef: { provider: 'tmdb', providerId: '30984' },
      releaseYear: 2004,
    } as MediaGovernanceTask;
    const legacyPlanSha256 = sha256Json(legacyPlan);
    const collapsedPlan = buildCanonicalIdentityRebasePlan(
      wrongTask,
      legacyPlan,
      {
        amendmentPlanSha256: 'a'.repeat(64),
        previousPlanSha256: legacyPlanSha256,
        providerTitle: '死神',
        summary: '错误把二级 TMDB 身份折叠为主资料库身份',
      },
      new Date('2026-08-23T03:18:55.643Z'),
    );
    const collapsedPlanSha256 = sha256Json(collapsedPlan);

    const restored = buildCatalogIdentityRestorationPlan(
      catalogTask,
      collapsedPlan,
      {
        previousPlanSha256: collapsedPlanSha256,
        summary: '恢复用户创建任务时选择的 Bangumi 身份',
      },
      new Date('2026-08-23T05:00:00.000Z'),
    );

    expect(restored).toMatchObject({
      catalogIdentity: {
        mediaType: 'tv',
        providerRef: { provider: 'bangumi', providerId: '302286' },
        releaseYear: 2022,
        title: '死神 千年血战篇',
      },
      catalogIdentityRestoration: {
        amendmentPlanSha256: 'a'.repeat(64),
        previousPlanSha256: collapsedPlanSha256,
        restoredTitleRoot:
          '/vol2/1000/Media/movie/TV/死神 千年血战篇 (2022) [bangumiid-302286]',
      },
      identity: {
        providerRef: { provider: 'tmdb', providerId: '30984' },
        releaseYear: 2004,
      },
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '30984',
        providerTitle: '死神',
        releaseYear: 2004,
      },
    });
    expect(restored.manifests).toEqual(collapsedPlan.manifests);
    expect(restored.sourceEvidence).toEqual(collapsedPlan.sourceEvidence);
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
    expect(() =>
      buildAdminMediaGovernancePlan(task, {
        ...payload,
        files: [payload.files[0]!, payload.files[0]!, payload.files[2]!],
      }),
    ).toThrow('governance-payload-file-invalid');
    expect(() =>
      buildAdminMediaGovernancePlan(task, {
        ...payload,
        files: [
          { ...payload.files[0]!, sizeBytes: 2_048 },
          payload.files[1]!,
          payload.files[2]!,
        ],
      }),
    ).toThrow('governance-payload-file-invalid');
    expect(() =>
      buildAdminMediaGovernancePlan(task, {
        ...payload,
        files: [
          {
            ...payload.files[0]!,
            path: `${root}/.kt-shards/shard-00/Show.S00E01.mkv`,
          },
          payload.files[1]!,
          payload.files[2]!,
        ],
      }),
    ).toThrow('governance-payload-file-invalid');
  });
});
