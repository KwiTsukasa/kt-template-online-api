import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/qqbot/plugins/bangdream/src/domain/common/model-utils';
import {
  getServerByPriority,
  Server,
} from '@/modules/qqbot/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';

export interface CardResourceSource {
  cardId: number;
  releasedAt: Array<number | null>;
  resourceSetName: string;
}

export type CardImageType = 'icon' | 'illustration' | 'trim';

/**
 * 获取卡牌资源训练状态后缀。
 *
 * @param trainingStatus - BangDream列表；影响 toTrainingSuffix 的返回值。
 */
function toTrainingSuffix(trainingStatus: boolean): string {
  return trainingStatus ? '_after_training' : '_normal';
}

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 *
 * @param server - server 输入；影响 toServerCode 的返回值。
 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class CardResourceRepository {
  /**
   * 初始化 CardResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取卡牌远端详情。
   *
   * @param cardId - 卡牌 ID；定位本次读取、更新、删除或关联的卡牌。
   * @param update - update 输入；限定 BangDream查询范围。
   */
  async getDetail(
    cardId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/cards/${cardId}.json`,
      { cacheTime: update ? 0 : 1 / 0 },
    );
  }

  /**
   * 获取卡牌资源批次目录。
   *
   * @param cardId - 卡牌 ID；定位本次读取、更新、删除或关联的卡牌。
   */
  getRip(cardId: number): string {
    if (cardId >= 9999) return '200_rip';
    const cardResourceSetId = Math.floor(cardId / 50);
    return `${formatNumber(cardResourceSetId, 3)}_rip`;
  }

  /**
   * 获取卡牌图片资源路径。
   *
   * @param source - source 输入；使用 `releasedAt`、`cardId`、`resourceSetName` 字段生成结果。
   * @param imageType - imageType 输入；决定 BangDream条件分支。
   * @param trainingStatus - BangDream列表；驱动 `toTrainingSuffix()` 的 BangDream步骤。
   * @param displayedServerList - displayedServerList 输入；驱动 `toServerCode()` 的 BangDream步骤。
   */
  getImagePath(
    source: CardResourceSource,
    imageType: CardImageType,
    trainingStatus: boolean,
    displayedServerList: Server[] = globalDefaultServer,
  ): string {
    const serverCode = toServerCode(
      getServerByPriority(source.releasedAt, displayedServerList),
    );
    const trainingSuffix = toTrainingSuffix(trainingStatus);
    if (imageType === 'icon') {
      return `/assets/${serverCode}/thumb/chara/card00${this.getRip(source.cardId)}/${source.resourceSetName}${trainingSuffix}.png`;
    }
    const fileName =
      imageType === 'trim' ? `trim${trainingSuffix}` : `card${trainingSuffix}`;
    return `/assets/${serverCode}/characters/resourceset/${source.resourceSetName}_rip/${fileName}.png`;
  }

  /**
   * 下载卡牌图片资源。
   *
   * @param source - source 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param imageType - imageType 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param trainingStatus - BangDream列表；驱动 `provider.getAsset()` 的 BangDream步骤。
   */
  async getImageBuffer(
    source: CardResourceSource,
    imageType: CardImageType,
    trainingStatus: boolean,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getImagePath(source, imageType, trainingStatus),
      imageType === 'icon' ? undefined : { memoryCache: false },
    );
  }
}

export const cardResourceRepository = new CardResourceRepository();
