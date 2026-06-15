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
});
