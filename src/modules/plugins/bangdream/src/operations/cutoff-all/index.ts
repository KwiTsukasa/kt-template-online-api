import { drawCutoffAll } from '@/modules/plugins/bangdream/src/domain/cutoff/cutoff-all.renderer';
import { getPresentEvent } from '@/modules/plugins/bangdream/src/domain/event/event.model';
import { BANGDREAM_CUTOFF_BASE_CATALOG_KEYS } from '@/modules/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/plugins/bangdream/src/operations/operation';

export const cutoffAllOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_CUTOFF_BASE_CATALOG_KEYS,
  handlerName: 'getCutoffAll',
  execute: async (input, context) => {
    const tokens = context.getTokens(input);
    const mainServer = context.pickMainServer(input, tokens);
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(tokens) ??
      getPresentEvent(mainServer).eventId;
    const options = context.getRenderOptions({ ...input, mainServer });

    return context.toImageReply(
      'bangdream.cutoff.all',
      `${eventId}`,
      await drawCutoffAll(eventId, mainServer, options.compress),
    );
  },
};
