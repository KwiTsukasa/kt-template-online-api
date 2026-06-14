jest.mock(
  '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade',
  () => ({
    QqbotBangDreamRendererService: class QqbotBangDreamRendererService {},
  }),
);

jest.mock('@/modules/qqbot/plugins/bangDream/shared/main-data-store', () => ({
  __esModule: true,
  default: {},
  waitForMainDataReady: jest.fn().mockResolvedValue(undefined),
}));

import { ToolsService } from '@/common';
import { TsuguApplicationService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service';
import { waitForMainDataReady } from '@/modules/qqbot/plugins/bangDream/shared/main-data-store';
import type { QqbotBangDreamRendererService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-renderer.facade';

describe('TsuguApplicationService', () => {
  let rendererService: jest.Mocked<QqbotBangDreamRendererService>;
  let service: TsuguApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    rendererService = {
      checkHealth: jest.fn().mockResolvedValue(true),
      executeOperationHandler: jest.fn().mockResolvedValue({
        imageCount: 1,
        operationKey: 'bangdream.song.search',
        query: '夏祭り',
        replyText: '[CQ:image,file=base64://base64-song-card]',
        source: 'Tsugu BangDream Bot 内置源码',
      }),
      refreshDictionaryCache: jest.fn().mockResolvedValue(undefined),
    } as any;
    service = new TsuguApplicationService(rendererService, new ToolsService());
  });

  it('refreshes dictionary cache during application bootstrap', async () => {
    await service.onApplicationBootstrap();

    expect(rendererService.refreshDictionaryCache).toHaveBeenCalledTimes(1);
  });

  it('executes a registry operation through the renderer handler', async () => {
    const result = await service.execute('bangdream.song.search', {
      text: '夏祭り',
    });

    expect(waitForMainDataReady).toHaveBeenCalledTimes(1);
    expect(rendererService.executeOperationHandler).toHaveBeenCalledWith(
      'searchSong',
      {
        text: '夏祭り',
      },
    );
    expect(result).toMatchObject({
      imageCount: 1,
      operationKey: 'bangdream.song.search',
      query: '夏祭り',
    });
  });

  it('normalizes command errors into string messages', async () => {
    rendererService.executeOperationHandler.mockRejectedValueOnce(
      '图片渲染失败',
    );

    await expect(
      service.execute('bangdream.event.search', { text: '50' }),
    ).rejects.toThrow('图片渲染失败');
  });
});
