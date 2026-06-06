jest.mock(
  '@/qqbot/plugins/bangDream/application/bangdream-application.service',
  () => ({
    TsuguApplicationService: class TsuguApplicationService {},
  }),
);

import { QqbotBangDreamClientService } from '@/qqbot/plugins/bangDream/application/bangdream-client.service';
import type { TsuguApplicationService } from '@/qqbot/plugins/bangDream/application/bangdream-application.service';

describe('QqbotBangDreamClientService', () => {
  let service: QqbotBangDreamClientService;
  let tsuguApplicationService: jest.Mocked<TsuguApplicationService>;

  beforeEach(() => {
    tsuguApplicationService = {
      checkHealth: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        imageCount: 1,
        operationKey: 'bangdream.song.search',
        query: '夏祭り',
        replyText: '[CQ:image,file=base64://base64-song-card]',
        source: 'Tsugu BangDream Bot 内置源码',
      }),
    } as any;
    service = new QqbotBangDreamClientService(tsuguApplicationService);
  });

  it('checks embedded Tsugu application health', async () => {
    await expect(service.checkHealth()).resolves.toBe(true);

    expect(tsuguApplicationService.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('searches song through embedded Tsugu application facade', async () => {
    const result = await service.searchSong({ text: '夏祭り' });

    expect(tsuguApplicationService.execute).toHaveBeenCalledWith(
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

    expect(tsuguApplicationService.execute).toHaveBeenCalledWith(
      'bangdream.card.search',
      {
        text: '1399',
      },
    );
  });

  it('bubbles embedded Tsugu renderer errors as command errors', async () => {
    tsuguApplicationService.execute.mockRejectedValueOnce(
      new Error('错误: 没有有效的关键词'),
    );

    await expect(service.searchSong({ text: '???' })).rejects.toThrow(
      '错误: 没有有效的关键词',
    );
  });
});
