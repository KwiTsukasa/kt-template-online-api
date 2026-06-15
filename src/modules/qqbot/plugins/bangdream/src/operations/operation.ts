import type { BangDreamCommandContext } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-command-context';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationHandlerName,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/qqbot-bangdream.types';

export type BangDreamOperationExecute = (
  input: QqbotBangDreamCommandInput,
  context: BangDreamCommandContext,
) => Promise<QqbotBangDreamCommandOutput>;

export type BangDreamOperationModule = {
  execute: BangDreamOperationExecute;
  expectedImageCount?: number;
  handlerName: QqbotBangDreamOperationHandlerName;
};
