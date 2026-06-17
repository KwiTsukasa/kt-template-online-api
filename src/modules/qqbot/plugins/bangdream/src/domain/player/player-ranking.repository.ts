import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export class PlayerRankingResourceRepository {
  /**
   * 初始化 PlayerRankingResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取玩家排名徽章资源路径。
   *
   * @param server - server 输入；限定 BangDream查询范围。
   * @param ranking - ranking 输入；限定 BangDream查询范围。
   */
  getRankImagePath(server: Server, ranking: number): string {
    return `/res/image/${Server[server]}_${ranking}.png`;
  }

  /**
   * 下载玩家排名徽章资源。
   *
   * @param server - server 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param ranking - ranking 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getRankImageBuffer(server: Server, ranking: number): Promise<Buffer> {
    return await this.provider.getAsset(this.getRankImagePath(server, ranking));
  }
}

export const playerRankingResourceRepository =
  new PlayerRankingResourceRepository();
