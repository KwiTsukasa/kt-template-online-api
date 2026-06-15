import { drawCutoffDetail } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-detail.renderer';
import { drawCutoffEventTop } from '@/modules/qqbot/plugins/bangdream/src/domain/cutoff/cutoff-event-top.renderer';
import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const cutoffDetailOperation: BangDreamOperationModule = {
  handlerName: 'getCutoffDetail',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const tier = context.requireNumber(input.tier, tokens[0], '请提供档位');
    const mainServer = context.pickMainServer(input, tokens.slice(1));
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(tokens.slice(1)) ??
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
