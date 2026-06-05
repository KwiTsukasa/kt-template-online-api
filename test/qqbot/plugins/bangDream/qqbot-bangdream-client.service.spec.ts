jest.mock(
  '@/qqbot/plugins/bangDream/renderer/qqbot-bangdream-renderer.service',
  () => ({
    QqbotBangDreamRendererService: class QqbotBangDreamRendererService {},
  }),
);

import { QqbotBangDreamClientService } from '@/qqbot/plugins/bangDream/qqbot-bangdream-client.service';
import type { QqbotBangDreamRendererService } from '@/qqbot/plugins/bangDream/renderer/qqbot-bangdream-renderer.service';

describe('QqbotBangDreamClientService', () => {
  let service: QqbotBangDreamClientService;
  let rendererService: jest.Mocked<QqbotBangDreamRendererService>;

  beforeEach(() => {
    rendererService = {
      checkHealth: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        imageCount: 1,
        operationKey: 'bangdream.song.search',
        query: '夏祭り',
        replyText: '[CQ:image,file=base64://base64-song-card]',
        source: 'Tsugu BangDream Bot 内置源码',
      }),
    } as any;
    service = new QqbotBangDreamClientService(rendererService);
  });

  it('checks embedded Tsugu renderer health', async () => {
    await expect(service.checkHealth()).resolves.toBe(true);

    expect(rendererService.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('searches song through embedded Tsugu renderer', async () => {
    const result = await service.searchSong({ text: '夏祭り' });

    expect(rendererService.execute).toHaveBeenCalledWith(
      'bangdream.song.search',
      {
        text: '夏祭り',
      },
    );
    expect(result).toMatchObject({
      imageCount: 1,
      query: '夏祭り',
      source: 'Tsugu BangDream Bot 内置源码',
    });
    expect(result.replyText).toBe('[CQ:image,file=base64://base64-song-card]');
  });

  it('executes other Tsugu open commands through the same plugin facade', async () => {
    await service.execute('bangdream.card.search', { text: '1399' });

    expect(rendererService.execute).toHaveBeenCalledWith(
      'bangdream.card.search',
      {
        text: '1399',
      },
    );
  });

  it('bubbles embedded Tsugu renderer errors as command errors', async () => {
    rendererService.execute.mockRejectedValueOnce(
      new Error('错误: 没有有效的关键词'),
    );

    await expect(service.searchSong({ text: '???' })).rejects.toThrow(
      '错误: 没有有效的关键词',
    );
  });
});
