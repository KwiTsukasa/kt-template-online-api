import { Player } from '@/modules/qqbot/plugins/bangdream/src/domain/player/player.model';
import type { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export class PlayerRepository {
  /**
   * 创建玩家领域模型。
   *
   * @param playerId - 玩家 ID；定位本次读取、更新、删除或关联的玩家。
   * @param server - server 输入；驱动 `Player()` 的 BangDream步骤。
   */
  create(playerId: number, server: Server): Player {
    return new Player(playerId, server);
  }
}

export const playerRepository = new PlayerRepository();
