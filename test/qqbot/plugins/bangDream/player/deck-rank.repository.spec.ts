import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { DeckRankResourceRepository } from '@/qqbot/plugins/bangDream/player/deck-rank.repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream deck rank resource repository', () => {
  it('builds local and remote rank image paths', () => {
    const repository = new DeckRankResourceRepository(
      createProviderMock(),
      'D:/KT/assets/Rank',
    );

    expect(repository.getLocalRankImagePath('rank_4_1')).toBe(
      path.join('D:/KT/assets/Rank', 'rank_4_1.png'),
    );
    expect(repository.getRemoteRankImagePath('rank_4_1')).toBe(
      '/res/icon/rank_4_1.png',
    );
  });

  it('uses local rank image buffers before remote fallback', async () => {
    const provider = createProviderMock();
    const localRootPath = mkdtempSync(path.join(tmpdir(), 'kt-rank-'));
    const localImagePath = path.join(localRootPath, 'rank_1.png');
    const localBuffer = Buffer.from('local-rank');
    writeFileSync(localImagePath, localBuffer);
    const repository = new DeckRankResourceRepository(
      provider,
      localRootPath,
    );

    try {
      await expect(repository.getRankImageBuffer('rank_1')).resolves.toEqual(
        localBuffer,
      );
      expect(provider.getAsset).not.toHaveBeenCalled();
    } finally {
      rmSync(localRootPath, { force: true, recursive: true });
    }
  });

  it('downloads rank image buffers through the provider when local asset is missing', async () => {
    const provider = createProviderMock();
    const remoteBuffer = Buffer.from('remote-rank');
    provider.getAsset.mockResolvedValue(remoteBuffer);
    const repository = new DeckRankResourceRepository(
      provider,
      path.join(tmpdir(), 'missing-rank-root'),
    );

    await expect(repository.getRankImageBuffer('rank_7')).resolves.toBe(
      remoteBuffer,
    );

    expect(provider.getAsset).toHaveBeenCalledWith('/res/icon/rank_7.png');
  });
});
