import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export interface ItemResourceSource {
  resourceId: number;
  typeName: string;
}

/**
 * 执行 BangDream 插件流程。
 * @param server - server 输入；影响 toServerCode 的返回值。
 * @returns BangDream 插件渲染后的图片、画布或文本。
 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class ItemResourceRepository {
  /**
   * 初始化 ItemResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取道具缩略图资源路径。
   *
   * @param source - source 输入；使用 `typeName`、`resourceId` 字段生成结果。
   * @param server - server 输入；驱动 `toServerCode()` 的 BangDream步骤。
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
   * @param source - source 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param server - server 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getImageBuffer(
    source: ItemResourceSource,
    server: Server | undefined,
  ): Promise<Buffer> {
    return await this.provider.getAsset(this.getImagePath(source, server));
  }
}

export const itemResourceRepository = new ItemResourceRepository();
