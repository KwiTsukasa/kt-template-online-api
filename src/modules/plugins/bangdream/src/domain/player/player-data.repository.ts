import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { logger } from '@/modules/plugins/bangdream/src/application/bangdream-logger';
import { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';

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
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 按`playerId`、`server`、`mode`读取玩家资料 API 路径。
   * @param playerId - 用于精确定位玩家的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param mode - 选择玩家资料 API 路径处理分支的模式值。
   * @returns 按参数编码并拼接完成的玩家资料 API 路径。
   */
  getDetailPath(playerId: number, server: Server, mode: PlayerDetailMode) {
    return `/api/player/${Server[server]}/${playerId}?mode=${mode}`;
  }

  /**
   * 读取玩家详情，并在缓存模式 1 下保留后台刷新行为。
   * @param playerId - 用于精确定位玩家的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param useCache - 决定是否启用“use缓存”分支的布尔选项。
   * @param mode - 选择详情处理分支的模式值。
   * @returns 详情。
   */
  async getDetail(
    playerId: number,
    server: Server,
    useCache: boolean,
    mode: PlayerDetailMode,
  ): Promise<PlayerDetailResponse> {
    const cacheTime = (() => {
      if (useCache) {
        return Infinity;
      }
      return 0;
    })();
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
   * @param playerId - 用于精确定位玩家的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @param mode - 选择后台刷新玩家缓存，失败只记日志，不影响当前查询结果处理分支的模式值。
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
