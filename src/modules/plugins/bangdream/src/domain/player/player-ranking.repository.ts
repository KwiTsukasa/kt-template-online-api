import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';

export class PlayerRankingResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `server`，获取玩家排名徽章资源路径。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param ranking - 决定根据参数 `server`，获取玩家排名徽章资源路径内容、边界或目标的 `ranking` 值。
   * @returns 按参数编码并拼接完成的根据参数 `server`，获取玩家排名徽章资源路径。
   */
  getRankImagePath(server: Server, ranking: number): string {
    return `/res/image/${Server[server]}_${ranking}.png`;
  }

  /**
   * 根据参数 `server`，下载玩家排名徽章资源。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param ranking - 决定根据参数 `server`，下载玩家排名徽章资源内容、边界或目标的 `ranking` 值。
   * @returns 根据参数 `server`，下载玩家排名徽章资源。
   */
  async getRankImageBuffer(server: Server, ranking: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getRankImagePath(server, ranking));
  }
}

export const playerRankingResourceRepository =
  new PlayerRankingResourceRepository();
