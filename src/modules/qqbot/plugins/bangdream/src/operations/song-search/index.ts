import { Song } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { drawSongDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-detail.renderer';
import { drawSongList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-search.renderer';
import { BANGDREAM_SONG_SEARCH_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songSearchOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_SEARCH_CATALOG_KEYS,
  handlerName: 'searchSong',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；驱动 `context.requireText()`、`context.getRenderOptions()` 的 BangDream步骤。
   * @param context - context 输入；执行 `context.requireText()`、`context.getRenderOptions()`、`context.isInteger()`、`context.drawFuzzyResult()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
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
