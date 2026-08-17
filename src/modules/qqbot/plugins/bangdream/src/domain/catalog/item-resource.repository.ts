import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export interface ItemResourceSource {
  resourceId: number;
  typeName: string;
}

/**
 * 将`server`转换为服务器代码；当 `server == null` 成立时返回 `'undefined'`。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 当前状态对应的服务器代码，取值为 `'undefined'`；没有可用结果或提前结束时为 `undefined`。
 */
function toServerCode(server: Server | undefined): string {
  if (server == null) {
    return 'undefined';
  }
  return Server[server];
}

export class ItemResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `source`，获取道具缩略图资源路径。
   * @param source - 用于根据参数 `source`，获取道具缩略图资源路径的领域对象，包含 `typeName`、`resourceId` 字段。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `source`，获取道具缩略图资源路径。
   */
  getImagePath(source: ItemResourceSource, server: Server | undefined): string {
    const serverCode = toServerCode(server);
    if (source.typeName === 'material') {
      return `/assets/${serverCode}/thumb/material_rip/${source.typeName}${formatNumber(source.resourceId, 3)}.png`;
    }
    if (source.typeName === 'star') {
      return `/assets/${serverCode}/thumb/common_rip/star.png`;
    }
    return `/assets/${serverCode}/thumb/common_rip/${source.typeName}${source.resourceId}.png`;
  }

  /**
   * 根据参数 `source`，下载道具缩略图资源。
   * @param source - 决定根据参数 `source`，下载道具缩略图资源内容、边界或目标的 `source` 值。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 根据参数 `source`，下载道具缩略图资源。
   */
  async getImageBuffer(
    source: ItemResourceSource,
    server: Server | undefined,
  ): Promise<Buffer> {
    return await this.provider.getAsset(this.getImagePath(source, server));
  }
}

export const itemResourceRepository = new ItemResourceRepository();
