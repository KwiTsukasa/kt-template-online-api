import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawSongDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-detail.renderer';
import { drawSongList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer';
import { BANGDREAM_SONG_SEARCH_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_SEARCH_CATALOG_KEYS,
  handlerName: 'searchSong',
  execute: async (input, context) => {
    const query = context.requireText(input, '请提供歌曲名或歌曲 ID');
    const options = context.getRenderOptions(input);
    const images = context.isInteger(query)
      ? await drawSongDetail(
          new Song(Number(query)),
          options.displayedServerList,
          options.compress,
        )
      : await context.drawFuzzyResult(query, (matches) =>
          drawSongList(matches, options.displayedServerList, options.compress),
        );

    return context.toImageReply('bangdream.song.search', query, images);
  },
};
