import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export interface ItemResourceSource {
  resourceId: number;
  typeName: string;
}

function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class ItemResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 获取道具缩略图资源路径。
   *
   * @param source - 道具资源来源字段。
   * @param server - 目标服务器。
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
   * 下载道具缩略图资源。
   *
   * @param source - 道具资源来源字段。
   * @param server - 目标服务器。
   */
  async getImageBuffer(
    source: ItemResourceSource,
    server: Server | undefined,
  ): Promise<Buffer> {
    return await this.provider.getAsset(this.getImagePath(source, server));
  }
}

export const itemResourceRepository = new ItemResourceRepository();
