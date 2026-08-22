import type { BangDreamCommandContext } from '@/modules/plugins/bangdream/src/application/bangdream-command-context';
import type {
  BangDreamCommandInput,
  BangDreamCommandOutput,
  BangDreamOperationHandlerName,
} from '@/modules/plugins/bangdream/src/domain/common/bangdream.types';
import type { BangDreamCatalogKey } from '@/modules/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';

export type BangDreamOperationExecute = (
  input: BangDreamCommandInput,
  context: BangDreamCommandContext,
) => Promise<BangDreamCommandOutput>;

export type BangDreamOperationModule = {
  catalogKeys?: readonly BangDreamCatalogKey[];
  execute: BangDreamOperationExecute;
  expectedImageCount?: number;
  handlerName: BangDreamOperationHandlerName;
};
