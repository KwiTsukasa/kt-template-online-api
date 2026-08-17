import { drawCutoffDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer';
import { drawCutoffEventTop } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.renderer';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { BANGDREAM_CUTOFF_DETAIL_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

const CUTOFF_DETAIL_COMMAND_ALIASES = new Set([
  'ycx',
  '预测线',
  '查档线',
  'bd档线',
]);
const DEFAULT_CUTOFF_DETAIL_TIER = 1000;

export const cutoffDetailOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CUTOFF_DETAIL_CATALOG_KEYS,
  handlerName: 'getCutoffDetail',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const hasCommandAlias = CUTOFF_DETAIL_COMMAND_ALIASES.has(tokens[0]);
    const argumentTokens = (() => {
      if (hasCommandAlias) {
        return tokens.slice(1);
      }
      return tokens;
    })();
    const explicitTier = context.optionalNumber(input.tier);
    const tierFromText = context.optionalNumber(argumentTokens[0]);
    const tier =
      explicitTier ??
      tierFromText ??
      ((() => {
        if (hasCommandAlias || argumentTokens.length === 0) {
          return DEFAULT_CUTOFF_DETAIL_TIER;
        }
        return undefined;
      })());
    if (tier === undefined) throw new Error('请提供档位');

    const remainingTokens =
      (() => {
        if (explicitTier === undefined && tierFromText !== undefined) {
          return argumentTokens.slice(1);
        }
        return argumentTokens;
      })();
    const mainServer = context.pickMainServer(input, remainingTokens);
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(remainingTokens) ??
      getPresentEvent(mainServer).eventId;
    const options = context.getRenderOptions({ ...input, mainServer });
    const images = await (async () => {
        if (tier === 10) {
          return await drawCutoffEventTop(eventId, mainServer, options.compress);
        }
        return await drawCutoffDetail(eventId, tier, mainServer, options.compress);
      })();

    return context.toImageReply(
      'bangdream.cutoff.detail',
      `${tier} ${eventId}`,
      images,
    );
  },
};
