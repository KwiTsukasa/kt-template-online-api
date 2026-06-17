import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
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
  /**
   * 初始化 PlayerDataRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 构建玩家资料 API 路径。
   *
   * @param playerId - 玩家 ID；定位本次读取、更新、删除或关联的玩家。
   * @param server - server 输入；限定 BangDream查询范围。
   * @param mode - mode 输入；限定 BangDream查询范围。
   */
  getDetailPath(playerId: number, server: Server, mode: PlayerDetailMode) {
    return `/api/player/${Server[server]}/${playerId}?mode=${mode}`;
  }

  /**
   * 读取玩家详情，并在缓存模式 1 下保留后台刷新行为。
   *
   * @param playerId - 玩家 ID；定位本次读取、更新、删除或关联的玩家。
   * @param server - server 输入；驱动 `this.getDetailPath()`、`this.refreshCache()` 的 BangDream步骤。
   * @param useCache - useCache 输入；限定 BangDream查询范围。
   * @param mode - mode 输入；驱动 `this.getDetailPath()`、`this.refreshCache()` 的 BangDream步骤。
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
   * @param playerId - 玩家 ID；定位本次读取、更新、删除或关联的玩家。
   * @param server - server 输入；驱动 `getJson()` 的 BangDream步骤。
   * @param mode - mode 输入；驱动 `getJson()` 的 BangDream步骤。
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
