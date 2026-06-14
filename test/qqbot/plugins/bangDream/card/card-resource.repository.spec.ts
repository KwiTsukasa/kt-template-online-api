import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import {
  CardResourceRepository,
  type CardResourceSource,
} from '@/modules/qqbot/plugins/bangDream/card/card-resource.repository';
import { Server } from '@/modules/qqbot/plugins/bangDream/catalog/server.model';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

function createCardSource(
  overrides: Partial<CardResourceSource> = {},
): CardResourceSource {
  return {
    cardId: 472,
    releasedAt: [100, null, null, 200, null],
    resourceSetName: 'res0472',
    ...overrides,
  };
}

describe('BangDream card resource repository', () => {
  it('routes card detail requests through the provider with explicit cache policy', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ ok: true });
    const repository = new CardResourceRepository(provider);

    await expect(repository.getDetail(472, true)).resolves.toEqual({
      ok: true,
    });
    await expect(repository.getDetail(472, false)).resolves.toEqual({
      ok: true,
    });

    expect(provider.getJson).toHaveBeenNthCalledWith(1, '/api/cards/472.json', {
      cacheTime: 0,
    });
    expect(provider.getJson).toHaveBeenNthCalledWith(2, '/api/cards/472.json', {
      cacheTime: Infinity,
    });
  });

  it('builds card resource rip directories from card ids', () => {
    const repository = new CardResourceRepository(createProviderMock());

    expect(repository.getRip(472)).toBe('009_rip');
    expect(repository.getRip(9999)).toBe('200_rip');
  });

  it('builds icon, illustration, and trim asset paths from server priority', () => {
    const repository = new CardResourceRepository(createProviderMock());
    const source = createCardSource();
    const serverPriority = [Server.cn, Server.jp];

    expect(repository.getImagePath(source, 'icon', false, serverPriority)).toBe(
      '/assets/cn/thumb/chara/card00009_rip/res0472_normal.png',
    );
    expect(
      repository.getImagePath(source, 'illustration', true, serverPriority),
    ).toBe(
      '/assets/cn/characters/resourceset/res0472_rip/card_after_training.png',
    );
    expect(repository.getImagePath(source, 'trim', false, serverPriority)).toBe(
      '/assets/cn/characters/resourceset/res0472_rip/trim_normal.png',
    );
  });

  it('keeps heavy card artwork outside provider memory cache', async () => {
    const provider = createProviderMock();
    const assetBuffer = Buffer.from('asset');
    provider.getAsset.mockResolvedValue(assetBuffer);
    const repository = new CardResourceRepository(provider);
    const source = createCardSource();
    const expectedIconPath =
      '/assets/cn/thumb/chara/card00009_rip/res0472_normal.png';
    const expectedIllustrationPath =
      '/assets/cn/characters/resourceset/res0472_rip/card_after_training.png';

    await expect(
      repository.getImageBuffer(source, 'icon', false),
    ).resolves.toBe(assetBuffer);
    await repository.getImageBuffer(source, 'illustration', true);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      expectedIconPath,
      undefined,
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      expectedIllustrationPath,
      { memoryCache: false },
    );
  });
});
