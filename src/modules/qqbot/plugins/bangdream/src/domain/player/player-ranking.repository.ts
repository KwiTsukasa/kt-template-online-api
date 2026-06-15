import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export class PlayerRankingResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取玩家排名徽章资源路径。
   *
   * @param server - 目标服务器。
   * @param ranking - 排名。
   */
  getRankImagePath(server: Server, ranking: number): string {
    return `/res/image/${Server[server]}_${ranking}.png`;
  }

  /**
   * 下载玩家排名徽章资源。
   *
   * @param server - 目标服务器。
   * @param ranking - 排名。
   */
  async getRankImageBuffer(server: Server, ranking: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getRankImagePath(server, ranking));
  }
}

export const playerRankingResourceRepository =
  new PlayerRankingResourceRepository();
