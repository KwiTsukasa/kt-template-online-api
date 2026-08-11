import {
  MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS,
  MediaGovernanceContractError,
  assertAllowedMediaPath,
  assertSourceClassification,
  assertWorkflowTransition,
  buildDescriptorObjectKey,
  buildMediaGovernanceDomainFixture,
  decideSourceHealth,
  projectEventRetention,
  projectMetadataGate,
  projectRunRetention,
  validateAgentBoundaryRequest,
  validateDescriptorManifestEntry,
  validateMetadataException,
  validateSubtitleContracts,
} from '../../../src/modules/admin/media-governance/media-governance-domain';

function expectContractError(callback: () => unknown, code: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(MediaGovernanceContractError);
    expect((error as MediaGovernanceContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected contract error: ${code}`);
}

describe('media governance domain contract', () => {
  it.each(MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS)(
    'accepts operator classification $contentKind with $sourceRole',
    (classification) => {
      expect(
        assertSourceClassification({
          ...classification,
          linkedTask:
            classification.sourceRole === 'supplemental_subtitle'
              ? {
                  contentKind: 'subtitleless_media',
                  runState: 'blocked',
                  stage: 'intake',
                }
              : null,
        }),
      ).toEqual(classification.governanceProfile);
    },
  );

  it.each(MEDIA_GOVERNANCE_SOURCE_CLASSIFICATIONS)(
    'rejects the illegal role for $contentKind',
    (classification) => {
      expectContractError(
        () =>
          assertSourceClassification({
            ...classification,
            linkedTask: null,
            sourceRole:
              classification.sourceRole === 'primary_media'
                ? 'supplemental_subtitle'
                : 'primary_media',
          }),
        'source-classification-mismatch',
      );
    },
  );

  it('requires supplemental subtitles to bind an open subtitleless task', () => {
    expectContractError(
      () =>
        assertSourceClassification({
          contentKind: 'sidecar_subtitle_package',
          governanceProfile: null,
          linkedTask: {
            contentKind: 'subtitleless_media',
            runState: 'succeeded',
            stage: 'closed',
          },
          sourceRole: 'supplemental_subtitle',
        }),
      'supplemental-subtitle-task-closed',
    );
  });

  it('allows different release groups between seasons but never inside one season', () => {
    expect(
      validateSubtitleContracts([
        {
          expectedEpisodeNumbers: [1, 2],
          mappings: [
            { episodeNumber: 1, releaseGroup: 'DBD-Raws' },
            { episodeNumber: 2, releaseGroup: 'DBD-Raws' },
          ],
          seasonNumber: 'S01',
          sourceId: 'source-s01',
        },
        {
          expectedEpisodeNumbers: [1, 2],
          mappings: [
            { episodeNumber: 1, releaseGroup: 'Lilith-Raws' },
            { episodeNumber: 2, releaseGroup: 'Lilith-Raws' },
          ],
          seasonNumber: 'S02',
          sourceId: 'source-s02',
        },
      ]).map((contract) => contract.releaseGroup),
    ).toEqual(['DBD-Raws', 'Lilith-Raws']);

    expectContractError(
      () =>
        validateSubtitleContracts([
          {
            expectedEpisodeNumbers: [1, 2],
            mappings: [
              { episodeNumber: 1, releaseGroup: 'DBD-Raws' },
              { episodeNumber: 2, releaseGroup: 'Lilith-Raws' },
            ],
            seasonNumber: 'S00',
            sourceId: 'source-s00',
          },
        ]),
      'subtitle-season-mixed-release-group',
    );
  });

  it('derives the private descriptor key and rejects unsafe manifest paths', () => {
    expect(
      buildDescriptorObjectKey({
        descriptorRevision: 3,
        descriptorSha256: 'a'.repeat(64),
        sourceId: 'source-01',
        taskId: 'media-task-01',
        transportKind: 'torrent',
      }),
    ).toBe(
      `tasks/media-task-01/sources/source-01/revisions/3-${'a'.repeat(64)}.torrent`,
    );
    expect(
      validateDescriptorManifestEntry({
        entryType: 'file',
        executable: false,
        relativePath: 'Season 01/作品 - S01E01.mkv',
      }),
    ).toBe('Season 01/作品 - S01E01.mkv');

    for (const entry of [
      {
        entryType: 'file' as const,
        executable: false,
        relativePath: '../escape.mkv',
      },
      {
        entryType: 'file' as const,
        executable: false,
        relativePath: '/absolute.mkv',
      },
      {
        entryType: 'file' as const,
        executable: false,
        relativePath: 'C:\\escape.mkv',
      },
      {
        entryType: 'symbolic-link' as const,
        executable: false,
        relativePath: 'Season 01/link.mkv',
      },
      {
        entryType: 'file' as const,
        executable: true,
        relativePath: 'Season 01/run.exe',
      },
    ]) {
      expectContractError(
        () => validateDescriptorManifestEntry(entry),
        'descriptor-manifest-path-unsafe',
      );
    }
  });

  it('fails closed on undeclared roots and symbolic links', () => {
    expect(
      assertAllowedMediaPath({
        allowedRoots: ['/vol2/1000/.kt-media-governance-staging/media-task-01'],
        candidate:
          '/vol2/1000/.kt-media-governance-staging/media-task-01/work/a.nfo',
        symbolicLink: false,
      }),
    ).toContain('/media-task-01/work/a.nfo');

    expectContractError(
      () =>
        assertAllowedMediaPath({
          allowedRoots: [
            '/vol2/1000/.kt-media-governance-staging/media-task-01',
          ],
          candidate: '/vol2/1000/Media/TV/escape.mkv',
          symbolicLink: false,
        }),
      'path-outside-allowed-roots',
    );
    expectContractError(
      () =>
        assertAllowedMediaPath({
          allowedRoots: [
            '/vol2/1000/.kt-media-governance-staging/media-task-01',
          ],
          candidate:
            '/vol2/1000/.kt-media-governance-staging/media-task-01/work/link.mkv',
          symbolicLink: true,
        }),
      'symbolic-link-rejected',
    );
    expectContractError(
      () =>
        assertAllowedMediaPath({
          allowedRoots: [
            '/vol2/1000/.kt-media-governance-staging/media-task-01',
          ],
          candidate:
            '/vol2/1000/.kt-media-governance-staging/media-task-01/work/../a.nfo',
          symbolicLink: false,
        }),
      'path-traversal-rejected',
    );
  });

  it('projects bounded source-health decisions without treating seed zero alone as dead', () => {
    expect(
      decideSourceHealth({
        bytesDelta: 0,
        completePeerCount: 0,
        elapsedSeconds: 45,
        localConnectivityHealthy: true,
        metadataAvailable: true,
        selectedAvailability: 1,
        trackerFailure: null,
      }),
    ).toEqual({ health: 'probing', reason: null });
    expect(
      decideSourceHealth({
        bytesDelta: 0,
        completePeerCount: 0,
        elapsedSeconds: 240,
        localConnectivityHealthy: false,
        metadataAvailable: true,
        selectedAvailability: 0,
        trackerFailure: null,
      }),
    ).toEqual({
      health: 'degraded',
      reason: 'local_connectivity_degraded',
    });
    expect(
      decideSourceHealth({
        bytesDelta: 0,
        completePeerCount: 0,
        elapsedSeconds: 240,
        localConnectivityHealthy: true,
        metadataAvailable: true,
        selectedAvailability: 0,
        trackerFailure: null,
      }),
    ).toEqual({ health: 'unavailable', reason: 'no_complete_peer' });
    expect(
      decideSourceHealth({
        bytesDelta: 1024,
        completePeerCount: 0,
        elapsedSeconds: 45,
        localConnectivityHealthy: true,
        metadataAvailable: true,
        selectedAvailability: 1,
        trackerFailure: null,
      }),
    ).toEqual({ health: 'viable', reason: null });
  });

  it('projects A/B/C metadata and only permits evidence-backed B fallbacks', () => {
    expect(
      projectMetadataGate({
        missingA: [],
        missingB: [],
        missingC: ['artwork.fanart'],
        validBFallbacks: [],
      }),
    ).toEqual({ optionalMissing: 1, status: 'complete' });
    expect(
      projectMetadataGate({
        missingA: [],
        missingB: ['artwork.season'],
        missingC: [],
        validBFallbacks: ['artwork.season'],
      }),
    ).toEqual({ fallbackCount: 1, status: 'evidence-fallback' });
    expect(
      projectMetadataGate({
        missingA: ['identity.provider'],
        missingB: [],
        missingC: [],
        validBFallbacks: [],
      }),
    ).toEqual({ hardGateFailures: ['identity.provider'], status: 'blocked' });

    expectContractError(
      () =>
        validateMetadataException({
          agentThreadId: 'thread-01',
          attempts: ['tmdb'],
          evidenceSha256: 'b'.repeat(64),
          fieldPath: 'identity.provider',
          policyVersion: 'media-agent-policy-v1',
          reasonCode: 'localized_value_unavailable',
          selectedFallback: 'fallback',
          sourcesChecked: ['tmdb'],
          taskRevision: 7,
          tier: 'A',
        }),
      'metadata-a-tier-exception-forbidden',
    );
    expectContractError(
      () =>
        validateMetadataException({
          agentThreadId: 'thread-01',
          attempts: ['tmdb'],
          evidenceSha256: 'b'.repeat(64),
          fieldPath: 'identity.provider',
          policyVersion: 'media-agent-policy-v1',
          reasonCode: 'localized_value_unavailable',
          selectedFallback: 'fallback',
          sourcesChecked: ['tmdb'],
          taskRevision: 7,
          tier: 'B',
        }),
      'metadata-exception-field-not-b-tier',
    );
  });

  it('projects the three retention layers and fails cleanup closed', () => {
    expect(projectEventRetention('state-transition')).toEqual({
      mysql: true,
      nasEvidence: true,
      redis: false,
    });
    expect(projectEventRetention('download-progress')).toEqual({
      mysql: false,
      nasEvidence: true,
      redis: true,
    });
    expectContractError(
      () => projectEventRetention('unknown-progress-typo'),
      'event-type-unsupported',
    );
    expect(
      projectRunRetention({
        ageDays: 180,
        closed: true,
        evidenceSealed: true,
        evidenceShaVerified: true,
        hasActiveRun: false,
        hasRecovery: false,
      }),
    ).toEqual({
      evidenceMayBeDeleted: false,
      hotMode: 'compressed-readonly',
      hotProgressMayBeDeleted: true,
    });
    expect(
      projectRunRetention({
        ageDays: 365,
        closed: true,
        evidenceSealed: true,
        evidenceShaVerified: true,
        hasActiveRun: true,
        hasRecovery: false,
      }).hotProgressMayBeDeleted,
    ).toBe(false);

    const fixture = buildMediaGovernanceDomainFixture();
    expect(fixture.schemas).toEqual([
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
    ]);
    expect(fixture.retention.activeMayBeDeleted).toBe(false);
    expect(fixture.retention.closedEvidenceMayBeDeleted).toBe(false);
    expect(JSON.stringify(fixture)).not.toContain('passkey');
    expect(JSON.stringify(fixture)).not.toContain('tracker.example');
  });

  it('accepts only the declared orthogonal workflow transitions', () => {
    expect(
      assertWorkflowTransition({
        evidenceType: 'plan-sealed',
        next: { runState: 'queued', stage: 'governance' },
        previous: { runState: 'ready', stage: 'governance' },
      }),
    ).toEqual({ runState: 'queued', stage: 'governance' });
    expectContractError(
      () =>
        assertWorkflowTransition({
          evidenceType: 'operator-clicked',
          next: { runState: 'succeeded', stage: 'closed' },
          previous: { runState: 'draft', stage: 'intake' },
        }),
      'workflow-transition-invalid',
    );
  });

  it('binds policy, capsule, manifest, roots and cloud gate before Agent work', () => {
    const fixture = buildMediaGovernanceDomainFixture();
    const request = {
      instructionSource: 'task-capsule',
      paths: [
        '/vol2/1000/.kt-media-governance-staging/media-task-fixture/work/a.nfo',
      ],
      requestsCloud: false,
      symbolicLinkPaths: [],
      tool: 'plan.submit.sealed',
    };
    expect(
      validateAgentBoundaryRequest({
        capsule: fixture.capsule,
        policy: fixture.policy,
        request,
        task: fixture.task,
        units: fixture.units,
      }),
    ).toEqual({ allowed: true });

    expectContractError(
      () =>
        validateAgentBoundaryRequest({
          capsule: fixture.capsule,
          policy: { ...fixture.policy, allowedRoots: ['/'] },
          request,
          task: fixture.task,
          units: fixture.units,
        }),
      'agent-policy-root-invalid',
    );

    expectContractError(
      () =>
        validateAgentBoundaryRequest({
          capsule: fixture.capsule,
          policy: {
            ...fixture.policy,
            permissionProfile: 'unexpected-profile' as never,
          },
          request,
          task: fixture.task,
          units: fixture.units,
        }),
      'agent-policy-runtime-invalid',
    );

    fixture.capsule.cloudGate = true;
    expectContractError(
      () =>
        validateAgentBoundaryRequest({
          capsule: fixture.capsule,
          policy: fixture.policy,
          request: { ...request, requestsCloud: true },
          task: fixture.task,
          units: fixture.units,
        }),
      'local-acceptance-incomplete',
    );
  });
});
