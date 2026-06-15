import { drawCutoffDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer';
import { drawCutoffEventTop } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.renderer';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

const CUTOFF_DETAIL_COMMAND_ALIASES = new Set([
  'ycx',
  '预测线',
  '查档线',
  'bd档线',
]);
const DEFAULT_CUTOFF_DETAIL_TIER = 1000;

export const cutoffDetailOperation: BangDreamOperationModule = {
  handlerName: 'getCutoffDetail',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const hasCommandAlias = CUTOFF_DETAIL_COMMAND_ALIASES.has(tokens[0]);
    const argumentTokens = hasCommandAlias ? tokens.slice(1) : tokens;
    const explicitTier = context.optionalNumber(input.tier);
    const tierFromText = context.optionalNumber(argumentTokens[0]);
    const tier =
      explicitTier ??
      tierFromText ??
      (hasCommandAlias || argumentTokens.length === 0
        ? DEFAULT_CUTOFF_DETAIL_TIER
        : undefined);
    if (tier === undefined) throw new Error('请提供档位');

    const remainingTokens =
      explicitTier === undefined && tierFromText !== undefined
        ? argumentTokens.slice(1)
        : argumentTokens;
    const mainServer = context.pickMainServer(input, remainingTokens);
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(remainingTokens) ??
      getPresentEvent(mainServer).eventId;
    const options = context.getRenderOptions({ ...input, mainServer });
    const images =
      tier === 10
        ? await drawCutoffEventTop(eventId, mainServer, options.compress)
        : await drawCutoffDetail(eventId, tier, mainServer, options.compress);

    return context.toImageReply(
      'bangdream.cutoff.detail',
      `${tier} ${eventId}`,
      images,
    );
  },
};
