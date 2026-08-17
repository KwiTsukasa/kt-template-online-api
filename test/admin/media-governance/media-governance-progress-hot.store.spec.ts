import type Redis from 'ioredis';
import type { MediaGovernanceExecutorEventDto } from '../../../src/modules/admin/media-governance/contract/media-governance.dto';
import { MediaGovernanceRedisProgressHotStore } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';

describe('MediaGovernanceRedisProgressHotStore', () => {
  function progressEvent(
    completedBytes: number,
    summary: string,
  ): MediaGovernanceExecutorEventDto {
    return {
      action: 'source.download',
      evidenceSha256: 'e'.repeat(64),
      eventType: 'download-progress',
      manifest: [
        {
          executable: false,
          index: 0,
          relativePath: '不应进入热层.mkv',
          sizeBytes: 1_000,
        },
      ],
      observedAt: '2026-08-17T10:00:00.000Z',
      payloadFiles: [
        {
          index: 0,
          mtimeMs: 1,
          path: '/vol2/1000/.kt-media-governance-staging/private.mkv',
          relativePath: 'private.mkv',
          sha256: 'f'.repeat(64),
          sizeBytes: 1_000,
          sourceId: 'media-source-12345678',
        },
      ],
      progress: {
        completedBytes,
        completedItems: 0,
        etaLabel: '下载中',
        speedBytesPerSecond: completedBytes,
        totalBytes: 1_000,
        totalItems: 1,
      },
      runId: 'media-run-12345678',
      sequence: 2,
      sourceId: 'media-source-12345678',
      summary,
      taskId: 'media-task-12345678',
      taskRevision: 3,
    };
  }

  it('requests the authoritative sequence once when the Redis cursor is cold', async () => {
    const evalMock = jest.fn<Promise<number[]>, unknown[]>();
    evalMock.mockResolvedValue([0, 0, 0, 0, 1]);
    const redis = {
      eval: evalMock,
    };
    const store = new MediaGovernanceRedisProgressHotStore(
      redis as unknown as Redis,
    );

    await expect(
      store.append(progressEvent(10, '下载 10 字节'), null),
    ).resolves.toMatchObject({
      applied: false,
      authorityRequired: true,
      sequenceGap: false,
    });
    expect(evalMock.mock.calls[0]?.[6]).toBe('-1');
  });

  it('writes only a bounded progress projection and ignores per-tick summary in the snapshot fingerprint', async () => {
    const evalMock = jest.fn<Promise<number[]>, unknown[]>();
    evalMock
      .mockResolvedValueOnce([1, 1, 0, 1, 0])
      .mockResolvedValueOnce([1, 2, 0, 0, 0]);
    const redis = {
      eval: evalMock,
    };
    const store = new MediaGovernanceRedisProgressHotStore(
      redis as unknown as Redis,
    );

    await store.append(progressEvent(10, '下载 10 字节'), 1);
    await store.append(progressEvent(11, '下载 11 字节'), 2);

    const firstPayload = JSON.parse(String(evalMock.mock.calls[0]?.[7]));
    expect(firstPayload).toEqual({
      eventType: 'download-progress',
      observedAt: '2026-08-17T10:00:00.000Z',
      progress: expect.objectContaining({ completedBytes: 10 }),
      runId: 'media-run-12345678',
      sequence: 2,
      sourceId: 'media-source-12345678',
      summary: '下载 10 字节',
      taskId: 'media-task-12345678',
    });
    expect(firstPayload).not.toHaveProperty('evidenceSha256');
    expect(firstPayload).not.toHaveProperty('manifest');
    expect(firstPayload).not.toHaveProperty('payloadFiles');
    expect(evalMock.mock.calls[0]?.[11]).toBe(evalMock.mock.calls[1]?.[11]);
  });
});
