import { bangdreamBestdoriProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bestdori.provider';
import type { BangDreamDataProvider } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/bangdream-data-provider';
import type { BangDreamCardArtAttribute } from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';
import {
  createCardIconFramePath,
  createCardIllustrationFramePath,
} from '@/modules/qqbot/plugins/bangdream/src/domain/card/card-art.layout';

export class CardArtResourceRepository {
  /**
   * 初始化 CardArtResourceRepository 实例。
   * @param provider - provider 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly provider: BangDreamDataProvider = bangdreamBestdoriProvider,
  ) {}

  /**
   * 下载卡牌小图边框资源。
   *
   * @param rarity - rarity 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param attribute - attribute 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
   * @param rarity - rarity 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
   * @param attribute - attribute 输入；驱动 `provider.getAsset()` 的 BangDream步骤。
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
