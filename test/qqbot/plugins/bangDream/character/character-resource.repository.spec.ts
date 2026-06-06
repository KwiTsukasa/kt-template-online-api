import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { CharacterResourceRepository } from '@/qqbot/plugins/bangDream/character/character-resource.repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream character resource repository', () => {
  it('routes character detail requests through the provider with explicit cache policy', async () => {
    const provider = createProviderMock();
    provider.getJson.mockResolvedValue({ ok: true });
    const repository = new CharacterResourceRepository(provider);

    await expect(repository.getDetail(1, true)).resolves.toEqual({ ok: true });
    await expect(repository.getDetail(1, false)).resolves.toEqual({
      ok: true,
    });

    expect(provider.getJson).toHaveBeenNthCalledWith(
      1,
      '/api/characters/1.json',
      { cacheTime: 0 },
    );
    expect(provider.getJson).toHaveBeenNthCalledWith(
      2,
      '/api/characters/1.json',
      { cacheTime: Infinity },
    );
  });

  it('builds icon, illustration, and name banner paths', () => {
    const repository = new CharacterResourceRepository(createProviderMock());

    expect(repository.getIconPath(1)).toBe('/res/icon/chara_icon_1.png');
    expect(repository.getIllustrationPath(1)).toBe(
      '/assets/jp/ui/character_kv_image/001_rip/image.png',
    );
    expect(repository.getNameBannerPath(1)).toBe(
      '/assets/jp/character_name_rip/name_top_chr01.png',
    );
  });

  it('downloads character assets through the provider', async () => {
    const provider = createProviderMock();
    const iconBuffer = Buffer.from('icon');
    const illustrationBuffer = Buffer.from('illustration');
    const nameBannerBuffer = Buffer.from('name-banner');
    provider.getAsset
      .mockResolvedValueOnce(iconBuffer)
      .mockResolvedValueOnce(illustrationBuffer)
      .mockResolvedValueOnce(nameBannerBuffer);
    const repository = new CharacterResourceRepository(provider);

    await expect(repository.getIconBuffer(1)).resolves.toBe(iconBuffer);
    await expect(repository.getIllustrationBuffer(1)).resolves.toBe(
      illustrationBuffer,
    );
    await expect(repository.getNameBannerBuffer(1)).resolves.toBe(
      nameBannerBuffer,
    );

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/res/icon/chara_icon_1.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/jp/ui/character_kv_image/001_rip/image.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      3,
      '/assets/jp/character_name_rip/name_top_chr01.png',
    );
  });
});
