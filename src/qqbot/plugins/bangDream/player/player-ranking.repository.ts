import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';

export class PlayerRankingResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
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
