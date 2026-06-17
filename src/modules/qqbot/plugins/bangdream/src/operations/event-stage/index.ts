import { getPresentEvent } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event.model';
import { drawEventStage } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.renderer';
import { BANGDREAM_EVENT_STAGE_CATALOG_KEYS } from '@/modules/qqbot/plugins/bangdream/src/operations/catalog-keys';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';

export const eventStageOperation: BangDreamOperationModule = {
  catalogKeys: BANGDREAM_EVENT_STAGE_CATALOG_KEYS,
  expectedImageCount: 5,
  handlerName: 'getEventStage',
  /**
   * 执行插件操作处理器。
   * @param input - input 输入；使用 `eventId`、`meta` 字段生成结果。
   * @param context - context 输入；执行 `context.getTokens()`、`context.pickMainServer()`、`context.optionalNumber()`、`context.firstNumber()` 对应的 BangDream步骤。
   * @returns 插件处理结果。
   */
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
