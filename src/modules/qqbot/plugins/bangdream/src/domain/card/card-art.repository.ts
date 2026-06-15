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
   * 下载卡牌小图边框资源。
   *
   * @param rarity - 卡牌稀有度。
   * @param attribute - 卡牌属性。
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
   * 下载卡牌插画边框资源。
   *
   * @param rarity - 卡牌稀有度。
   * @param attribute - 卡牌属性。
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
