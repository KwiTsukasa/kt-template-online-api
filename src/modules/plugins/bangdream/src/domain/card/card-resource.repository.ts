import { bangdreamBestdoriProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import { formatNumber } from '@/modules/plugins/bangdream/src/domain/common/model-utils';
import {
  getServerByPriority,
  Server,
} from '@/modules/plugins/bangdream/src/domain/catalog/server.model';
import { globalDefaultServer } from '@/modules/plugins/bangdream/src/config/runtime-config';

export interface CardResourceSource {
  cardId: number;
  releasedAt: Array<number | null>;
  resourceSetName: string;
}

export type CardImageType = 'icon' | 'illustration' | 'trim';

/**
 * 根据参数 `trainingStatus`，获取卡牌资源训练状态后缀。
 * @param trainingStatus - 决定根据参数 `trainingStatus`，获取卡牌资源训练状态后缀内容、边界或目标的 `trainingStatus` 值。
 * @returns 当前状态对应的根据参数 `trainingStatus`，获取卡牌资源训练状态后缀，取值为 `'_after_training'`、`'_normal'`。
 */
function toTrainingSuffix(trainingStatus: boolean): string {
  if (trainingStatus) {
    return '_after_training';
  }
  return '_normal';
}

/**
 * 将服务器枚举值转换为 Bestdori 资源路径中的服务器编码。
 * @param server - 用于选择数据分区、资源路径与展示语言的目标服务器。
 * @returns 当前状态对应的将服务器枚举值转换为 Bestdori 资源路径中的服务器编码，取值为 `'undefined'`；没有可用结果或提前结束时为 `undefined`。
 */
function toServerCode(server: Server | undefined): string {
  if (server == null) {
    return 'undefined';
  }
  return Server[server];
}

export class CardResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `cardId`，获取卡牌远端详情。
   * @param cardId - 用于精确定位卡牌的标识。
   * @param update - 决定根据参数 `cardId`，获取卡牌远端详情内容、边界或目标的 `update` 值；省略时默认采用 `true`。
   * @returns 根据参数 `cardId`，获取卡牌远端详情。
   */
  async getDetail(
    cardId: number,
    update: boolean = true,
  ): Promise<Record<string, any>> {
    return await this.provider.getJson<Record<string, any>>(
      `/api/cards/${cardId}.json`,
      { cacheTime: (() => {
        if (update) {
          return 0;
        }
        return 1 / 0;
      })() },
    );
  }

  /**
   * 根据参数 `cardId`，获取卡牌资源批次目录。
   * @param cardId - 用于精确定位卡牌的标识。
   * @returns 当前状态对应的根据参数 `cardId`，获取卡牌资源批次目录，取值为 `'200_rip'`。
   */
  getRip(cardId: number): string {
    if (cardId >= 9999) return '200_rip';
    const cardResourceSetId = Math.floor(cardId / 50);
    return `${formatNumber(cardResourceSetId, 3)}_rip`;
  }

  /**
   * 根据参数 `source`，获取卡牌图片资源路径。
   * @param source - 用于根据参数 `source`，获取卡牌图片资源路径的领域对象，包含 `releasedAt`、`cardId`、`resourceSetName` 字段。
   * @param imageType - 决定根据参数 `source`，获取卡牌图片资源路径内容、边界或目标的 `imageType` 值。
   * @param trainingStatus - 决定根据参数 `source`，获取卡牌图片资源路径内容、边界或目标的 `trainingStatus` 值。
   * @param displayedServerList - 决定根据参数 `source`，获取卡牌图片资源路径内容、边界或目标的 `displayedServerList` 值；省略时默认采用 `globalDefaultServer`。
   * @returns 按参数编码并拼接完成的根据参数 `source`，获取卡牌图片资源路径。
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
      (() => {
        if (imageType === 'trim') {
          return `trim${trainingSuffix}`;
        }
        return `card${trainingSuffix}`;
      })();
    return `/assets/${serverCode}/characters/resourceset/${source.resourceSetName}_rip/${fileName}.png`;
  }

  /**
   * 根据参数 `source`，下载卡牌图片资源。
   * @param source - 决定根据参数 `source`，下载卡牌图片资源内容、边界或目标的 `source` 值。
   * @param imageType - 决定根据参数 `source`，下载卡牌图片资源内容、边界或目标的 `imageType` 值。
   * @param trainingStatus - 决定根据参数 `source`，下载卡牌图片资源内容、边界或目标的 `trainingStatus` 值。
   * @returns 根据参数 `source`，下载卡牌图片资源。
   */
  async getImageBuffer(
    source: CardResourceSource,
    imageType: CardImageType,
    trainingStatus: boolean,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      this.getImagePath(source, imageType, trainingStatus),
      (() => {
        if (imageType === 'icon') {
          return undefined;
        }
        return { memoryCache: false };
      })(),
    );
  }
}

export const cardResourceRepository = new CardResourceRepository();
