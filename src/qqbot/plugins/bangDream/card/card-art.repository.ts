import { bangDreamBestdoriProvider } from '@/qqbot/plugins/bangDream/provider/bestdori.provider';
import type { BangDreamDataProvider } from '@/qqbot/plugins/bangDream/provider/bangdream-data-provider';
import type { BangDreamCardArtAttribute } from '@/qqbot/plugins/bangDream/card/card-art.layout';
import {
  createCardIconFramePath,
  createCardIllustrationFramePath,
} from '@/qqbot/plugins/bangDream/card/card-art.layout';

export class CardArtResourceRepository {
  constructor(
    private readonly provider: BangDreamDataProvider = bangDreamBestdoriProvider,
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
