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
 * @param trainingStatus - 是否特训。
 */
function toTrainingSuffix(trainingStatus: boolean): string {
  return trainingStatus ? '_after_training' : '_normal';
}

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 *
 * @param server - 服务器枚举值。
 */
function toServerCode(server: Server | undefined): string {
  return server == null ? 'undefined' : Server[server];
}

export class CardResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 获取卡牌远端详情。
   *
   * @param cardId - 卡牌 ID。
   * @param update - 是否绕过缓存。
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
   * @param cardId - 卡牌 ID。
   */
  getRip(cardId: number): string {
    if (cardId >= 9999) return '200_rip';
    const cardResourceSetId = Math.floor(cardId / 50);
    return `${formatNumber(cardResourceSetId, 3)}_rip`;
  }

  /**
   * 获取卡牌图片资源路径。
   *
   * @param source - 卡牌资源来源字段。
   * @param imageType - 图片类型。
   * @param trainingStatus - 是否使用特训后资源。
   * @param displayedServerList - 可展示服务器优先级。
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
   * @param source - 卡牌资源来源字段。
   * @param imageType - 图片类型。
   * @param trainingStatus - 是否使用特训后资源。
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
