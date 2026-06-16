import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import type { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';

describe('BangDream song search rendering', () => {
  it('renders song list items sequentially to keep canvas memory bounded', async () => {
    const { renderSongListItemsSequentially } = await import(
      '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer'
    );
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const songs = [1, 2, 3].map(
      (songId) =>
        ({
          songId,
        }) as Song,
    );

    const images = await renderSongListItemsSequentially(
      songs,
      [Server.cn, Server.jp],
      async (song) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        order.push(song.songId);
        active--;
        return {
          height: song.songId,
          width: song.songId,
        } as any;
      },
    );

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(images.map((image) => image.width)).toEqual([1, 2, 3]);
  });

  it('keeps Tsugu song list style by loading jackets with the requested server priority', async () => {
    const { Canvas } = await import('skia-canvas');
    const { drawSongInList } = await import(
      '@/modules/qqbot/plugins/bangdream/src/domain/song/song-list.renderer'
    );
    const requestedServers = [Server.cn, Server.jp];
    const getSongJacketImage = jest.fn(async () => new Canvas(64, 64));
    const song = {
      bandId: 1,
      difficulty: {
        0: { playLevel: 9 },
      },
      getSongJacketImage,
      musicTitle: ['FIRE BIRD', 'FIRE BIRD', 'FIRE BIRD', 'FIRE BIRD'],
      publishedAt: [1, 1, 1, 1, 1],
      songId: 187,
    } as unknown as Song;

    await drawSongInList(song, undefined, 'Roselia', requestedServers);

    expect(getSongJacketImage).toHaveBeenCalledWith(requestedServers);
  });

  it('does not replace fuzzy search list jackets with lightweight placeholders', async () => {
    const { renderSongListItemsSequentially } = await import(
      '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer'
    );
    const renderOptions: unknown[] = [];
    const songs = [187, 243].map(
      (songId) =>
        ({
          songId,
        }) as Song,
    );
    const renderer = (async (
      _song,
      _difficulty,
      _text,
      _displayedServerList,
      options,
    ) => {
      renderOptions.push(options);
      return {
        height: 1,
        width: 1,
      } as any;
    }) as any;

    await renderSongListItemsSequentially(songs, [Server.cn], renderer);

    expect(renderOptions).toEqual([undefined, undefined]);
  });
});
