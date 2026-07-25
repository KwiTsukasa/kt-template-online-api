import { drawSongChart } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart.renderer';
import { BANGDREAM_SONG_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songChartOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_CATALOG_KEYS,
  handlerName: 'getSongChart',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const songId = context.requireNumber(
      input.songId,
      tokens[0],
      '请提供歌曲 ID',
    );
    const difficulty = context.pickDifficulty(
      input.difficulty ?? input.difficultyText ?? tokens.slice(1).join(' '),
    );
    const options = context.getRenderOptions(input);

    return context.toImageReply(
      'bangdream.song.chart',
      `${songId}${difficulty === undefined ? '' : ` ${difficulty}`}`,
      await drawSongChart(
        songId,
        difficulty ?? 3,
        options.displayedServerList,
        options.compress,
      ),
    );
  },
};
