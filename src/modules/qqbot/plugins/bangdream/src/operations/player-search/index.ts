import { drawPlayerDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player-detail.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const playerSearchOperation: BangDreamOperationModule = {
  handlerName: 'searchPlayer',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const playerId = context.requireNumber(
      input.playerId,
      tokens[0],
      '请提供玩家 ID',
    );
    const server = context.pickMainServer(input, tokens.slice(1));
    const options = context.getRenderOptions(input);

    return context.toImageReply(
      'bangdream.player.search',
      `${playerId}`,
      await drawPlayerDetail(
        playerId,
        server,
        options.useEasyBG,
        options.compress,
      ),
    );
  },
};
