import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { fuzzySearch } from '@/modules/plugins/bangdream/src/domain/search/fuzzy-search';
import { drawSongRandom } from '@/modules/plugins/bangdream/src/domain/song/song-random.renderer';
import { BANGDREAM_SONG_CATALOG_KEYS } from '@/modules/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/plugins/bangdream/src/operations/operation';

export const songRandomOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_CATALOG_KEYS,
  handlerName: 'randomSong',
  execute: async (input, context) => {
    const query = context.pickText(input);
    const options = context.getRenderOptions(input);
    const matches = (() => {
      if (query) {
        return fuzzySearch(query);
      }
      return {};
    })();

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
