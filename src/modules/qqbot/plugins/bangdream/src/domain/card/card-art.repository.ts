import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import type { BangDreamCardArtAttribute } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';
import {
  createCardIconFramePath,
  createCardIllustrationFramePath,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';

export class CardArtResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 根据参数 `rarity`，下载卡牌小图边框资源。
   * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
   * @param attribute - 决定卡牌属性图标与边框资源的属性。
   * @returns 根据参数 `rarity`，下载卡牌小图边框资源。
   */
  async getIconFrameBuffer(
    rarity: number,
    attribute: BangDreamCardArtAttribute,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      createCardIconFramePath(rarity, attribute),
    );
  }

  /**
   * 根据参数 `rarity`，下载卡牌插画边框资源。
   * @param rarity - 决定卡牌边框、星级数量与资源名称的稀有度。
   * @param attribute - 决定卡牌属性图标与边框资源的属性。
   * @returns 根据参数 `rarity`，下载卡牌插画边框资源。
   */
  async getIllustrationFrameBuffer(
    rarity: number,
    attribute: BangDreamCardArtAttribute,
  ): Promise<Buffer> {
    return await this.provider.getAsset(
      createCardIllustrationFramePath(rarity, attribute),
    );
  }
}

export const cardArtResourceRepository = new CardArtResourceRepository();
