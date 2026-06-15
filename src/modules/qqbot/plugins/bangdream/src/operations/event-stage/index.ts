import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { drawEventStage } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.renderer';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const eventStageOperation: BangDreamOperationModule = {
  expectedImageCount: 5,
  handlerName: 'getEventStage',
  execute: async (input, context) => {
    const tokens = context.getTokens(input).filter((item) => item !== '-m');
    const mainServer = context.pickMainServer(input, tokens);
    const eventId =
      context.optionalNumber(input.eventId) ??
      context.firstNumber(tokens) ??
      getPresentEvent(mainServer).eventId;
    const meta = context.normalizeBoolean(
      input.meta,
      context.getTokens(input).includes('-m'),
    );
    const options = context.getRenderOptions({ ...input, mainServer });

    return context.toImageReply(
      'bangdream.event.stage',
      `${eventId}`,
      await drawEventStage(eventId, mainServer, meta, options.compress),
    );
  },
};
