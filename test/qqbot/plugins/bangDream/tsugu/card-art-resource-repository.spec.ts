import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/tsugu/data-clients/data-provider';
import { CardArtResourceRepository } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/card-art-resource-repository';

function createProviderMock(): jest.Mocked<BangDreamDataProvider> {
  return {
    getAsset: jest.fn(),
    getJson: jest.fn(),
    getTracker: jest.fn(),
    name: 'MockBestdori',
    resolveUrl: jest.fn((pathOrUrl) => `https://bestdori.example${pathOrUrl}`),
  };
}

describe('BangDream card art resource repository', () => {
  it('downloads card icon and illustration frames through the provider', async () => {
    const provider = createProviderMock();
    const iconFrameBuffer = Buffer.from('icon-frame');
    const illustrationFrameBuffer = Buffer.from('illustration-frame');
    provider.getAsset
      .mockResolvedValueOnce(iconFrameBuffer)
      .mockResolvedValueOnce(illustrationFrameBuffer);
    const repository = new CardArtResourceRepository(provider);

    await expect(repository.getIconFrameBuffer(1, 'cool')).resolves.toBe(
      iconFrameBuffer,
    );
    await expect(
      repository.getIllustrationFrameBuffer(5, 'happy'),
    ).resolves.toBe(illustrationFrameBuffer);

    expect(provider.getAsset).toHaveBeenNthCalledWith(
      1,
      '/res/image/card-1-cool.png',
    );
    expect(provider.getAsset).toHaveBeenNthCalledWith(
      2,
      '/res/image/frame-5.png',
    );
  });
});
