import { mkdtempSync, promises as fs, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { DeckRankResourceRepository } from '@/modules/qqbot/plugins/bangdream/src/domain/player/deck-rank.repository';
import { configureBangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';

/**
 * 创建 BangDream 插件对象或配置。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
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
  afterEach(() => {
    configureBangDreamRuntimeIo({
      readAssetFile: undefined,
    });
  });

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
    configureBangDreamRuntimeIo({
      /**
       * 执行 BangDream回调。
       * @param filePath - BangDream路径；驱动 `fs.readFile()` 的 BangDream步骤。
       */
      readAssetFile: async (filePath) => await fs.readFile(filePath),
    });
    const repository = new DeckRankResourceRepository(provider, localRootPath);

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
    configureBangDreamRuntimeIo({
      /**
       * 执行 BangDream回调。
       */
      readAssetFile: async () => {
        throw new Error('local asset missing');
      },
    });
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
