import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { drawSongMetaList } from '@/modules/qqbot/plugins/bangdream/src/domain/song/song-meta.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const songMetaOperation: BangDreamOperationModule = {
  handlerName: 'getSongMeta',
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
