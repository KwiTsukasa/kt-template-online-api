import { drawSongChart } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-chart.renderer';
import { BANGDREAM_SONG_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songChartOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_CATALOG_KEYS,
  handlerName: 'getSongChart',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `songId`、`difficulty`、`difficultyText` 字段生成结果。
   * @param context - context 输入；执行 `context.getTokens()`、`context.requireNumber()`、`context.pickDifficulty()`、`context.getRenderOptions()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
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
