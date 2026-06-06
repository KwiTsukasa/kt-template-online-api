import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { DegreeResourceRepository } from '@/qqbot/plugins/bangDream/catalog/degree-resource.repository';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream degree resource repository', () => {
  it('builds degree thumbnail, frame, icon, and animated asset paths', () => {
    const repository = new DegreeResourceRepository(createProviderMock());

    expect(repository.getThumbnailPath('degree_001', Server.cn)).toBe(
      '/assets/cn/thumb/degree_rip/degree_001.png',
    );
    expect(repository.getFallbackThumbnailPath('degree_001', Server.cn)).toBe(
      '/assets/cn/thumb/degree_rip/assets-star-forassetbundle-startapp-thumbnail-degree-degree_001.png',
    );
    expect(repository.getFramePath('normal_1', Server.cn)).toBe(
      '/assets/cn/thumb/degree_rip/normal_1.png',
    );
    expect(repository.getIconPath('event_1', Server.cn)).toBe(
      '/assets/cn/thumb/degree_rip/event_1.png',
    );
    expect(
      repository.getAnimatedScriptPath('ani_degree_election_5th', Server.cn),
    ).toBe(
      '/assets/cn/ani_degree_election_5th_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_election_5th-ani_degree_election_5th.asset',
    );
  });

  it('keeps legacy animated degree texture paths for known old assets', () => {
    const repository = new DegreeResourceRepository(createProviderMock());

    expect(
      repository.getAnimatedTexturePath('ani_degree_bilibili_day1', Server.cn),
    ).toBe('/assets/cn/ani_degree_bilibili_day1_rip/ani_degree_bilibili_day1.png');
    expect(
      repository.getAnimatedTexturePath('ani_degree_election_5th', Server.cn),
    ).toBe(
      '/assets/cn/ani_degree_election_5th_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_election_5th-ani_degree_election_5th.png',
    );
  });

  it('falls back to the unified thumbnail path when the legacy thumbnail is missing', async () => {
    const provider = createProviderMock();
    const fallbackBuffer = Buffer.from('fallback-thumbnail');
    provider.getAsset
      .mockRejectedValueOnce(new Error('thumbnail missing'))
      .mockResolvedValueOnce(fallbackBuffer);
    const repository = new DegreeResourceRepository(provider);

    await expect(
      repository.getThumbnailBuffer('degree_001', Server.cn),
    ).resolves.toBe(fallbackBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/cn/thumb/degree_rip/degree_001.png',
      { ignoreError: false, memoryCache: false },
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/cn/thumb/degree_rip/assets-star-forassetbundle-startapp-thumbnail-degree-degree_001.png',
      { memoryCache: false },
    );
  });

  it('downloads degree frame, icon, script, and texture assets through the provider', async () => {
    const provider = createProviderMock();
    const frameBuffer = Buffer.from('frame');
    const iconBuffer = Buffer.from('icon');
    const scriptBuffer = Buffer.from('script');
    const textureBuffer = Buffer.from('texture');
    provider.getAsset
      .mockResolvedValueOnce(frameBuffer)
      .mockResolvedValueOnce(iconBuffer)
      .mockResolvedValueOnce(scriptBuffer)
      .mockResolvedValueOnce(textureBuffer);
    const repository = new DegreeResourceRepository(provider);

    await expect(repository.getFrameBuffer('normal_1', Server.cn)).resolves.toBe(
      frameBuffer,
    );
    await expect(repository.getIconBuffer('event_1', Server.cn)).resolves.toBe(
      iconBuffer,
    );
    await expect(
      repository.getAnimatedScriptBuffer('ani_degree_election_5th', Server.cn),
    ).resolves.toBe(scriptBuffer);
    await expect(
      repository.getAnimatedTextureBuffer('ani_degree_election_5th', Server.cn),
    ).resolves.toBe(textureBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/assets/cn/thumb/degree_rip/normal_1.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/assets/cn/thumb/degree_rip/event_1.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      3,
      '/assets/cn/ani_degree_election_5th_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_election_5th-ani_degree_election_5th.asset',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      4,
      '/assets/cn/ani_degree_election_5th_rip/assets-star-forassetbundle-startapp-thumbnail-animedegree-ani_degree_election_5th-ani_degree_election_5th.png',
    );
  });
});
