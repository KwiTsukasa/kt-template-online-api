import { ConfigService } from '@nestjs/config';
import { MediaGovernanceExecutionGatewayClient } from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import { buildMediaGovernanceExecutionEnvelope } from '../../../src/modules/admin/media-governance/contract/media-governance-executor.contract';

describe('MediaGovernanceExecutionGatewayClient', () => {
  const envelope = buildMediaGovernanceExecutionEnvelope({
    action: 'source.probe-runtime',
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
        transportKind: 'torrent',
      },
    ],
    taskId: 'media-task-fixture',
    taskRevision: 7,
    unitIds: ['media-unit-fixture-s01'],
  });

  afterEach(() => jest.restoreAllMocks());

  it('dispatches only the sealed envelope and validates the returned identity', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          executionId: 'jenkins-queue-1001',
          replayed: false,
          runId: envelope.runId,
          sealedInputSha256: envelope.sealedInputSha256,
          status: 'queued',
        }),
    } as Response);
    const gateway = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );

    await expect(gateway.dispatch(envelope)).resolves.toMatchObject({
      executionId: 'jenkins-queue-1001',
      replayed: false,
      status: 'queued',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('http://172.21.0.1:48088/v1/dispatch');
    expect(JSON.parse(String(init?.body))).toEqual(envelope);
    expect(String(init?.body)).not.toContain('s'.repeat(64));
    expect(init?.headers).toMatchObject({
      'x-kt-media-executor-secret': 's'.repeat(64),
    });
  });

  it('fails closed when the executor is not configured or changes identity', async () => {
    const disabled = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({}),
    );
    expect(disabled.enabled()).toBe(false);

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          executionId: 'jenkins-queue-1001',
          replayed: false,
          runId: 'media-run-foreign',
          sealedInputSha256: envelope.sealedInputSha256,
          status: 'queued',
        }),
    } as Response);
    const enabled = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );
    await expect(enabled.dispatch(envelope)).rejects.toThrow(
      'media-governance-executor-identity-mismatch',
    );
  });

  it('binds runtime status to the exact run, task and sealed input', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          activeState: 'inactive',
          exitCode: 1,
          result: 'exit-code',
          manifestSha256: 'f'.repeat(64),
          runId: envelope.runId,
          runnerId:
            'kt-media-governance-0123456789abcdef0123456789abcdef.service',
          sealedInputSha256: envelope.sealedInputSha256,
          status: 'exited',
          subState: 'dead',
          taskId: envelope.taskId,
          terminalEvent: {
            action: envelope.action,
            evidenceSha256: 'e'.repeat(64),
            eventType: 'run-succeeded',
            observedAt: '2026-08-11T12:00:01.000Z',
            runId: envelope.runId,
            sequence: 2,
            summary: '已封存终态等待 API 重放',
            taskId: envelope.taskId,
            taskRevision: envelope.taskRevision,
          },
        }),
    } as Response);
    const gateway = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );

    await expect(
      gateway.status({
        runId: envelope.runId,
        sealedInputSha256: envelope.sealedInputSha256,
        taskId: envelope.taskId,
      }),
    ).resolves.toMatchObject({
      manifestSha256: 'f'.repeat(64),
      status: 'exited',
      terminalEvent: { eventType: 'run-succeeded', sequence: 2 },
    });
    expect(request).toHaveBeenCalledWith(
      'http://172.21.0.1:48088/v1/status',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('recovers a sealed terminal event containing all 732 payload files', async () => {
    const payloadFiles = Array.from({ length: 732 }, (_value, index) => ({
      index,
      mtimeMs: 1_787_335_000_000 + index,
      path: `/vol2/1000/.kt-media-governance-staging/${envelope.taskId}/sources/media-source-fixture/Show/Episode-${String(index + 1).padStart(3, '0')}.mkv`,
      relativePath: `Show/Episode-${String(index + 1).padStart(3, '0')}.mkv`,
      sha256: 'a'.repeat(64),
      sizeBytes: 1_024,
      sourceId: 'media-source-fixture',
    }));
    const responseBody = JSON.stringify({
      activeState: 'inactive',
      exitCode: 0,
      manifestSha256: 'f'.repeat(64),
      result: 'success',
      runId: envelope.runId,
      runnerId:
        'kt-media-governance-0123456789abcdef0123456789abcdef.service',
      sealedInputSha256: envelope.sealedInputSha256,
      status: 'exited',
      subState: 'dead',
      taskId: envelope.taskId,
      terminalEvent: {
        action: envelope.action,
        evidenceSha256: 'e'.repeat(64),
        eventType: 'run-succeeded',
        observedAt: '2026-08-11T12:00:01.000Z',
        payloadFiles,
        runId: envelope.runId,
        sequence: 2,
        summary: '已封存 732 个载荷文件等待 API 重放',
        taskId: envelope.taskId,
        taskRevision: envelope.taskRevision,
      },
    });
    expect(Buffer.byteLength(responseBody)).toBeGreaterThan(32 * 1024);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => responseBody,
    } as Response);
    const gateway = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );

    const status = await gateway.status({
      runId: envelope.runId,
      sealedInputSha256: envelope.sealedInputSha256,
      taskId: envelope.taskId,
    });
    expect(status.terminalEvent?.payloadFiles).toHaveLength(732);
  });

  it('rejects an exited runner without a sealed terminal event', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          activeState: 'inactive',
          exitCode: 1,
          result: 'exit-code',
          runId: envelope.runId,
          runnerId:
            'kt-media-governance-0123456789abcdef0123456789abcdef.service',
          sealedInputSha256: envelope.sealedInputSha256,
          status: 'exited',
          subState: 'dead',
          taskId: envelope.taskId,
        }),
    } as Response);
    const gateway = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );

    await expect(
      gateway.status({
        runId: envelope.runId,
        sealedInputSha256: envelope.sealedInputSha256,
        taskId: envelope.taskId,
      }),
    ).rejects.toThrow('media-governance-executor-identity-mismatch');
  });

  it('sends an exact cancellation control for the active sealed run', async () => {
    const controlId = 'media-control-fixture-cancel-0001';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          command: 'cancel',
          controlId,
          replayed: false,
          runId: envelope.runId,
          status: 'accepted',
        }),
    } as Response);
    const gateway = new MediaGovernanceExecutionGatewayClient(
      new ConfigService({
        MEDIA_GOVERNANCE_EXECUTOR_BASE_URL: 'http://172.21.0.1:48088',
        MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: 's'.repeat(64),
      }),
    );

    await expect(
      gateway.control({
        command: 'cancel',
        controlId,
        runId: envelope.runId,
        sealedInputSha256: envelope.sealedInputSha256,
        taskId: envelope.taskId,
      }),
    ).resolves.toMatchObject({ command: 'cancel', replayed: false });
    expect(request).toHaveBeenCalledWith(
      'http://172.21.0.1:48088/v1/control',
      expect.objectContaining({
        body: JSON.stringify({
          command: 'cancel',
          controlId,
          runId: envelope.runId,
          sealedInputSha256: envelope.sealedInputSha256,
          taskId: envelope.taskId,
        }),
        method: 'POST',
      }),
    );
  });
});
