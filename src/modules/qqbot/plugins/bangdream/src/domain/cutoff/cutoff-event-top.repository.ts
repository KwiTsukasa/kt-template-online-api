import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { Server } from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';

export interface CutoffEventTopPoint {
  time: number;
  uid: number;
  value: number;
}

export interface CutoffEventTopUser {
  currentPt: number;
  degrees: number[];
  introduction: string;
  name: string;
  rank: number;
  ranking: number;
  sid: number;
  strained: number;
  uid: number;
}

export interface CutoffEventTopData {
  points: CutoffEventTopPoint[];
  users: CutoffEventTopUser[];
}

export class CutoffEventTopRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `eventId`，获取活动前十榜数据路径。
   * @param eventId - 用于精确定位事件的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 按参数编码并拼接完成的根据参数 `eventId`，获取活动前十榜数据路径。
   */
  getTopDataPath(eventId: number, server: Server): string {
    return `/api/eventtop/data?server=${server}&event=${eventId}&mid=0&interval=3600000`;
  }

  /**
   * 根据参数 `eventId`，获取活动前十榜数据。
   * @param eventId - 用于精确定位事件的标识。
   * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
   * @returns 根据参数 `eventId`，获取活动前十榜数据。
   */
  async getTopData(
    eventId: number,
    server: Server,
  ): Promise<CutoffEventTopData | undefined> {
    return await this.provider.getJson<CutoffEventTopData>(
      this.getTopDataPath(eventId, server),
    );
  }
}

export const cutoffEventTopRepository = new CutoffEventTopRepository();
