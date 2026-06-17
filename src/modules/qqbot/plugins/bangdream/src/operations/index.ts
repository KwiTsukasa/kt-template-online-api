import { cardIllustrationOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/card-illustration';
import { cardSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/card-search';
import { characterSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/character-search';
import { cutoffAllOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/cutoff-all';
import { cutoffDetailOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/cutoff-detail';
import { cutoffRecentOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/cutoff-recent';
import { eventSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/event-search';
import { eventStageOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/event-stage';
import { gachaSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/gacha-search';
import { gachaSimulateOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/gacha-simulate';
import type { BangDreamOperationModule } from '@/modules/qqbot/plugins/bangdream/src/operations/operation';
import { playerSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/player-search';
import { songChartOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/song-chart';
import { songMetaOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/song-meta';
import { songRandomOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/song-random';
import { songSearchOperation } from '@/modules/qqbot/plugins/bangdream/src/operations/song-search';

export const BANGDREAM_OPERATION_MODULES: BangDreamOperationModule[] = [
  songSearchOperation,
  songChartOperation,
  songRandomOperation,
  songMetaOperation,
  cardSearchOperation,
  cardIllustrationOperation,
  characterSearchOperation,
  eventSearchOperation,
  eventStageOperation,
  playerSearchOperation,
  gachaSearchOperation,
  gachaSimulateOperation,
  cutoffDetailOperation,
  cutoffAllOperation,
  cutoffRecentOperation,
];

/**
 * 查询 BangDream 插件数据。
 */
export function getBangDreamOperationsByHandlerName() {
  return new Map(
    BANGDREAM_OPERATION_MODULES.map((operation) => [
      operation.handlerName,
      operation,
    ]),
  );
}

export type { BangDreamOperationModule } from './operation';
