import { bangDreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export type PlayerDetailMode = 0 | 1 | 2 | 3;

export interface PlayerDetailResponse {
  data?: {
    cache?: boolean;
    profile?: Record<string, any> | null;
    time?: number;
  };
  result?: boolean;
}

export class PlayerDataRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
  ) {}

  /**
   * 构建玩家资料 API 路径。
   *
   * @param playerId - 玩家 ID。
   * @param server - 目标服务器。
   * @param mode - Bestdori 玩家查询模式。
   */
  getDetailPath(playerId: number, server: Server, mode: PlayerDetailMode) {
    return `/api/player/${Server[server]}/${playerId}?mode=${mode}`;
  }

  /**
   * 读取玩家详情，并在缓存模式 1 下保留后台刷新行为。
   *
   * @param playerId - 玩家 ID。
   * @param server - 目标服务器。
   * @param useCache - 是否只读取缓存。
   * @param mode - Bestdori 玩家查询模式。
   */
  async getDetail(
    playerId: number,
    server: Server,
    useCache: boolean,
    mode: PlayerDetailMode,
  ): Promise<PlayerDetailResponse> {
    const cacheTime = useCache ? Infinity : 0;
    const path = this.getDetailPath(playerId, server, mode);
    const playerData = await this.provider.getJson<PlayerDetailResponse>(path, {
      cacheTime,
      retryCount: 1,
    });
    if (mode === 1 && !Number.isFinite(cacheTime)) {
      this.refreshCache(playerId, server, mode);
    }
    return playerData;
  }

  /**
   * 后台刷新玩家缓存，失败只记日志，不影响当前查询结果。
   *
   * @param playerId - 玩家 ID。
   * @param server - 目标服务器。
   * @param mode - Bestdori 玩家查询模式。
   */
  refreshCache(playerId: number, server: Server, mode: PlayerDetailMode): void {
    this.provider
      .getJson(this.getDetailPath(playerId, server, mode), {
        cacheTime: 300,
        retryCount: 1,
      })
      .catch((err) => {
        logger('InitPlayer', err);
      });
  }
}

export const playerDataRepository = new PlayerDataRepository();
