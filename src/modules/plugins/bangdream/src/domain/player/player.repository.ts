import { Player } from '@/modules/plugins/bangdream/src/domain/player/player.model';
import type { Server } from '@/modules/plugins/bangdream/src/domain/catalog/server.model';

export class PlayerRepository {
  /**
   * 根据`playerId`、`server`构造`create` 对应结果。
   * @param playerId - 用于精确定位玩家的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 完成初始化并携带当前边界配置的`create` 对应。
   */
  create(playerId: number, server: Server): Player {
    return new Player(playerId, server);
  }
}

export const playerRepository = new PlayerRepository();
