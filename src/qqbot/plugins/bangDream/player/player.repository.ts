import { Player } from '@/qqbot/plugins/bangDream/player/player.model';
import type { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';

export class PlayerRepository {
  /**
   * 创建玩家领域模型。
   *
   * @param playerId - 玩家 ID。
   * @param server - 目标服务器。
   */
  create(playerId: number, server: Server): Player {
    return new Player(playerId, server);
  }
}

export const playerRepository = new PlayerRepository();
