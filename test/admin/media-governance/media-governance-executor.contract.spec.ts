import {
  MEDIA_GOVERNANCE_EXECUTOR_ACTIONS,
  buildMediaGovernanceExecutionEnvelope,
} from '../../../src/modules/admin/media-governance/contract/media-governance-executor.contract';

describe('MediaGovernanceExecutionEnvelope', () => {
  const base = {
    action: 'source.probe-runtime' as const,
    expiresAt: '2026-08-11T12:10:00.000Z',
    inputSnapshotSha256: '1'.repeat(64),
    replayKey: 'media-task-fixture-source-probe-r7',
    runId: 'media-run-fixture-source-probe-r7',
    sources: [
      {
        descriptorGrantId: 'media-grant-fixture-source-r1',
        descriptorRevision: 1,
        descriptorSha256: '2'.repeat(64),
        infoHash: '3'.repeat(40),
        manifestSha256: '4'.repeat(64),
        selectedBytes: 1_024,
        selectedFileCount: 1,
        selectedFileIndices: [0],
        sourceId: 'media-source-fixture',
        transportKind: 'torrent' as const,
      },
    ],
    taskId: 'media-task-fixture',
    taskRevision: 7,
    unitIds: ['media-unit-fixture-s01'],
  };

  it('publishes one fixed action universe for the complete production route', () => {
    expect(MEDIA_GOVERNANCE_EXECUTOR_ACTIONS).toEqual([
      'source.inspect',
      'source.probe-runtime',
      'source.download',
      'source.pause',
      'source.resume',
      'source.cleanup',
      'governance.preflight',
      'governance.plan',
      'governance.execute',
      'acceptance.verify',
      'canary.torrent',
      'canary.magnet',
    ]);
  });

  it('seals a source envelope without exposing a URI, tracker, passkey or path', () => {
    const envelope = buildMediaGovernanceExecutionEnvelope(base);
    const serialized = JSON.stringify(envelope);

    expect(envelope).toMatchObject({
      action: 'source.probe-runtime',
      flowId: 'kt.admin.media-governance-v1',
      schemaVersion: 'media-governance-execution-envelope-v1',
      taskRevision: 7,
    });
    expect(envelope.sealedInputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toMatch(/magnet:|https?:\/\/|tracker|passkey/i);
    expect(serialized).not.toContain('/vol2/');
    expect(buildMediaGovernanceExecutionEnvelope(base).sealedInputSha256).toBe(
      envelope.sealedInputSha256,
    );
  });

  it('preserves the explicit source selection instead of expanding the manifest', () => {
    const envelope = buildMediaGovernanceExecutionEnvelope({
      ...base,
      sources: [
        {
          ...base.sources[0],
          selectedFileIndices: [7],
        },
      ],
    });

    expect(envelope.sources?.[0]?.selectedFileIndices).toEqual([7]);
  });

  it('seals every task-owned source into one recovery run', () => {
    const envelope = buildMediaGovernanceExecutionEnvelope({
      ...base,
      action: 'source.resume',
      sources: [
        base.sources[0],
        {
          ...base.sources[0],
          descriptorGrantId: 'media-grant-fixture-source-r2',
          descriptorSha256: '5'.repeat(64),
          infoHash: '6'.repeat(40),
          manifestSha256: '7'.repeat(64),
          sourceId: 'media-source-fixture-subtitle',
        },
      ],
    });

    expect(envelope.action).toBe('source.resume');
    expect(envelope.sources).toHaveLength(2);
  });

  it('requires a task-bound descriptor grant for every source action', () => {
    expect(() =>
      buildMediaGovernanceExecutionEnvelope({
        ...base,
        sources: undefined,
      }),
    ).toThrow('source-contract-required');
  });

  it('requires a sealed Schema 1.2.0 plan for governance and acceptance', () => {
    expect(() =>
      buildMediaGovernanceExecutionEnvelope({
        ...base,
        action: 'governance.execute',
        sources: undefined,
      }),
    ).toThrow('sealed-plan-required');

    const envelope = buildMediaGovernanceExecutionEnvelope({
      ...base,
      action: 'acceptance.verify',
      plan: {
        planGrantId: 'media-plan-grant-fixture-r7',
        planSha256: '5'.repeat(64),
        schemaVersion: '1.2.0',
        strategy: 'sidecar-bundled',
      },
    });
    expect(envelope.plan).toEqual({
      planGrantId: 'media-plan-grant-fixture-r7',
      planSha256: '5'.repeat(64),
      schemaVersion: '1.2.0',
      strategy: 'sidecar-bundled',
    });
    expect(envelope.sources).toHaveLength(1);
  });

  it.each([
    ['stale revision', { taskRevision: 0 }],
    ['unsafe task identity', { taskId: '../media-task' }],
    ['unsafe replay key', { replayKey: 'run\nsecret' }],
    ['unsealed snapshot', { inputSnapshotSha256: 'bad' }],
    [
      'duplicate selected index',
      {
        sources: [
          {
            ...base.sources[0],
            selectedFileCount: 2,
            selectedFileIndices: [0, 0],
          },
        ],
      },
    ],
    [
      'manifest count mismatch',
      {
        sources: [{ ...base.sources[0], selectedFileCount: 2 }],
      },
    ],
  ])('fails closed on %s', (_name, override) => {
    expect(() =>
      buildMediaGovernanceExecutionEnvelope({ ...base, ...override }),
    ).toThrow();
  });
});
