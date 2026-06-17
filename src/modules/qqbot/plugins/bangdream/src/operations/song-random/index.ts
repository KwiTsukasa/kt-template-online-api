import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { fuzzySearch } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import { drawSongRandom } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-random.renderer';
import { BANGDREAM_SONG_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songRandomOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_CATALOG_KEYS,
  handlerName: 'randomSong',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；驱动 `context.pickText()`、`context.getRenderOptions()` 的 BangDream步骤。
   * @param context - context 输入；执行 `context.pickText()`、`context.getRenderOptions()`、`context.toImageReply()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const query = context.pickText(input);
    const options = context.getRenderOptions(input);
    const matches = query ? fuzzySearch(query) : {};

    return context.toImageReply(
      'bangdream.song.random',
      query || '随机曲',
      await drawSongRandom(
        matches,
        [options.mainServer as Server],
        true,
        options.compress,
      ),
    );
  },
};
