import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawSongMetaList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-meta.renderer';
import { BANGDREAM_SONG_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songMetaOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_SONG_CATALOG_KEYS,
  handlerName: 'getSongMeta',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；驱动 `context.pickMainServer()` 的 BangDream步骤。
   * @param context - context 输入；执行 `context.pickMainServer()`、`context.getTokens()`、`context.getRenderOptions()`、`context.toImageReply()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
  execute: async (input, context) => {
    const mainServer = context.pickMainServer(input, context.getTokens(input));
    const options = context.getRenderOptions({ ...input, mainServer });

    return context.toImageReply(
      'bangdream.song.meta',
      Server[mainServer],
      await drawSongMetaList(mainServer, options.compress),
    );
  },
};
