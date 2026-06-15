import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { fuzzySearch } from '@/modules/qqbot/plugins/bangdream/src/domain/search/fuzzy-search';
import { drawSongRandom } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-random.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songRandomOperation: BangDreamOperationModule = {
  handlerName: 'randomSong',
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
